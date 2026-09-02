#define _GNU_SOURCE
#define NAPI_VERSION 8

#include <errno.h>
#include <fcntl.h>
#include <node_api.h>
#include <poll.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#define MAX_FRAME_BYTES 32768
#define JS_MAX_SAFE_INTEGER 9007199254740991LL
#define DENIAL_CODE "VENTUREOS_NATIVE_LISTENER_DENIED"
#define DENIAL_MESSAGE "VentureOS native listener operation denied"

struct listener_state {
  int descriptor;
  bool active;
  bool creation_observed;
  bool accept_consumed;
  bool operation_active;
  bool session_active;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  struct stat parent_identity;
  struct stat listener_identity;
};

struct session_state {
  int descriptor;
  int phase;
  bool operation_active;
  struct listener_state *listener;
  napi_ref listener_ref;
};

enum operation_kind { OPERATION_ACCEPT, OPERATION_READ, OPERATION_WRITE };

struct async_operation {
  enum operation_kind kind;
  napi_env env;
  napi_async_work work;
  napi_deferred deferred;
  napi_ref owner_ref;
  napi_ref signal_ref;
  napi_ref abort_ref;
  int cancellation[2];
  atomic_bool cancelled;
  int error_number;
  struct listener_state *listener;
  struct session_state *session;
  int accepted_descriptor;
  uint8_t *bytes;
  size_t length;
};

static napi_value deny(napi_env env) {
  (void)napi_throw_error(env, DENIAL_CODE, DENIAL_MESSAGE);
  return NULL;
}

static void clear_bytes(void *data, size_t length) {
  volatile uint8_t *cursor = data;
  while (length > 0) {
    length -= 1;
    cursor[length] = 0;
  }
}

static int exact_argc(napi_env env, napi_callback_info info, size_t expected,
                      napi_value *values, napi_value *receiver) {
  size_t actual = 0;
  if (napi_get_cb_info(env, info, &actual, NULL, NULL, NULL) != napi_ok || actual != expected)
    return -1;
  actual = expected;
  return napi_get_cb_info(env, info, &actual, values, receiver, NULL) == napi_ok &&
                 actual == expected
             ? 0
             : -1;
}

static int named_value(napi_env env, napi_value object, const char *name, napi_value *result) {
  bool present = false;
  napi_value key;
  return napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &key) == napi_ok &&
                 napi_has_own_property(env, object, key, &present) == napi_ok &&
                 present && napi_get_named_property(env, object, name, result) == napi_ok
             ? 0
             : -1;
}

static int named_int64(napi_env env, napi_value object, const char *name, int64_t *result) {
  napi_value value;
  napi_valuetype type;
  return named_value(env, object, name, &value) == 0 &&
                 napi_typeof(env, value, &type) == napi_ok && type == napi_number &&
                 napi_get_value_int64(env, value, result) == napi_ok
             ? 0
             : -1;
}

static int named_exact_string(napi_env env, napi_value object, const char *name,
                              const char *expected) {
  napi_value value;
  napi_valuetype type;
  size_t required = 0;
  char observed[64];
  size_t copied = 0;
  return named_value(env, object, name, &value) == 0 &&
                 napi_typeof(env, value, &type) == napi_ok && type == napi_string &&
                 napi_get_value_string_utf8(env, value, NULL, 0, &required) == napi_ok &&
                 required == strlen(expected) && required < sizeof(observed) &&
                 napi_get_value_string_utf8(env, value, observed, sizeof(observed), &copied) ==
                     napi_ok &&
                 copied == required && strcmp(observed, expected) == 0
             ? 0
             : -1;
}

static int exact_string(napi_env env, napi_value value, char *output, size_t capacity) {
  napi_valuetype type;
  size_t required = 0;
  size_t copied = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, value, NULL, 0, &required) != napi_ok || required < 7 ||
      required >= capacity ||
      napi_get_value_string_utf8(env, value, output, capacity, &copied) != napi_ok ||
      copied != required || output[0] != '/' || memchr(output, '\0', copied) != NULL ||
      strcmp(output + required - 5, ".sock") != 0 || strstr(output, "//") != NULL ||
      strstr(output, "/../") != NULL || strstr(output, "/./") != NULL)
    return -1;
  return 0;
}

static int same_identity(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_uid == right->st_uid && left->st_gid == right->st_gid &&
         S_ISSOCK(left->st_mode) && S_ISSOCK(right->st_mode) &&
         (left->st_mode & 0777) == (right->st_mode & 0777);
}

static int same_directory_identity(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_uid == right->st_uid && left->st_gid == right->st_gid &&
         S_ISDIR(left->st_mode) && S_ISDIR(right->st_mode) &&
         (left->st_mode & 0777) == (right->st_mode & 0777);
}

static int safe_stat(const struct stat *identity) {
  return (uint64_t)identity->st_dev <= (uint64_t)JS_MAX_SAFE_INTEGER &&
         (uint64_t)identity->st_ino <= (uint64_t)JS_MAX_SAFE_INTEGER;
}

static int add_int64(napi_env env, napi_value object, const char *name, int64_t value) {
  napi_value field;
  return napi_create_int64(env, value, &field) == napi_ok &&
                 napi_set_named_property(env, object, name, field) == napi_ok
             ? 0
             : -1;
}

static int add_bool(napi_env env, napi_value object, const char *name, bool value) {
  napi_value field;
  return napi_get_boolean(env, value, &field) == napi_ok &&
                 napi_set_named_property(env, object, name, field) == napi_ok
             ? 0
             : -1;
}

static int add_string(napi_env env, napi_value object, const char *name, const char *value) {
  napi_value field;
  return napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &field) == napi_ok &&
                 napi_set_named_property(env, object, name, field) == napi_ok
             ? 0
             : -1;
}

static int add_identity(napi_env env, napi_value object, const char *name,
                        const struct stat *identity, const char *file_type) {
  napi_value value;
  if (!safe_stat(identity) || napi_create_object(env, &value) != napi_ok ||
      add_string(env, value, "fileType", file_type) != 0 ||
      add_int64(env, value, "device", (int64_t)identity->st_dev) != 0 ||
      add_int64(env, value, "inode", (int64_t)identity->st_ino) != 0 ||
      add_int64(env, value, "ownerUid", (int64_t)identity->st_uid) != 0 ||
      add_int64(env, value, "ownerGid", (int64_t)identity->st_gid) != 0 ||
      add_int64(env, value, "mode", (int64_t)(identity->st_mode & 0777)) != 0 ||
      napi_set_named_property(env, object, name, value) != napi_ok)
    return -1;
  return 0;
}

static napi_value identity_value(napi_env env, const struct stat *identity,
                                 const char *file_type) {
  napi_value result;
  if (!safe_stat(identity) || napi_create_object(env, &result) != napi_ok ||
      add_string(env, result, "fileType", file_type) != 0 ||
      add_int64(env, result, "device", (int64_t)identity->st_dev) != 0 ||
      add_int64(env, result, "inode", (int64_t)identity->st_ino) != 0 ||
      add_int64(env, result, "ownerUid", (int64_t)identity->st_uid) != 0 ||
      add_int64(env, result, "ownerGid", (int64_t)identity->st_gid) != 0 ||
      add_int64(env, result, "mode", (int64_t)(identity->st_mode & 0777)) != 0)
    return NULL;
  return result;
}

static void close_descriptor(int *descriptor) {
  if (*descriptor >= 0)
    (void)close(*descriptor);
  *descriptor = -1;
}

static void cleanup_listener_state(struct listener_state *state) {
  struct stat current;
  if (state == NULL)
    return;
  close_descriptor(&state->descriptor);
  if (state->active && state->path[0] != '\0' && lstat(state->path, &current) == 0 &&
      same_identity(&state->listener_identity, &current))
    (void)unlink(state->path);
  state->active = false;
}

static void finalize_listener(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  struct listener_state *state = data;
  cleanup_listener_state(state);
  clear_bytes(state, sizeof(*state));
  free(state);
}

static int close_session_state(napi_env env, struct session_state *state) {
  int failed = 0;
  if (state == NULL)
    return -1;
  if (state->descriptor >= 0 && close(state->descriptor) != 0)
    failed = -1;
  state->descriptor = -1;
  if (state->listener != NULL)
    state->listener->session_active = false;
  state->listener = NULL;
  if (state->listener_ref != NULL) {
    (void)napi_delete_reference(env, state->listener_ref);
    state->listener_ref = NULL;
  }
  state->phase = 3;
  return failed;
}

static void finalize_session(napi_env env, void *data, void *hint) {
  (void)hint;
  struct session_state *state = data;
  (void)close_session_state(env, state);
  clear_bytes(state, sizeof(*state));
  free(state);
}

static int get_listener(napi_env env, napi_value receiver, struct listener_state **state) {
  return napi_unwrap(env, receiver, (void **)state) == napi_ok && *state != NULL ? 0 : -1;
}

static int get_session(napi_env env, napi_value receiver, struct session_state **state) {
  return napi_unwrap(env, receiver, (void **)state) == napi_ok && *state != NULL ? 0 : -1;
}

static int signal_is_aborted(napi_env env, napi_value signal) {
  napi_value value;
  napi_valuetype type;
  bool aborted = true;
  return napi_get_named_property(env, signal, "aborted", &value) == napi_ok &&
                 napi_typeof(env, value, &type) == napi_ok && type == napi_boolean &&
                 napi_get_value_bool(env, value, &aborted) == napi_ok && !aborted
             ? 0
             : -1;
}

static napi_value abort_operation(napi_env env, napi_callback_info info) {
  void *data = NULL;
  size_t argc = 0;
  if (napi_get_cb_info(env, info, &argc, NULL, NULL, &data) != napi_ok || argc != 0 ||
      data == NULL)
    return deny(env);
  struct async_operation *operation = data;
  atomic_store_explicit(&operation->cancelled, true, memory_order_release);
  if (operation->cancellation[1] >= 0) {
    const uint8_t marker = 1;
    ssize_t written;
    do {
      written = write(operation->cancellation[1], &marker, sizeof(marker));
    } while (written < 0 && errno == EINTR);
    if (written < 0 && errno != EAGAIN && errno != EWOULDBLOCK)
      close_descriptor(&operation->cancellation[1]);
  }
  napi_value undefined;
  return napi_get_undefined(env, &undefined) == napi_ok ? undefined : NULL;
}

static void clear_pending_exception(napi_env env) {
  bool pending = false;
  napi_value ignored;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending)
    (void)napi_get_and_clear_last_exception(env, &ignored);
}

static int attach_abort(napi_env env, struct async_operation *operation, napi_value owner,
                        napi_value signal) {
  napi_value callback;
  napi_value method;
  napi_value event;
  napi_value options;
  napi_value once;
  napi_value arguments[3];
  if (signal_is_aborted(env, signal) != 0 || pipe2(operation->cancellation, O_CLOEXEC | O_NONBLOCK) !=
                                                0 ||
      napi_create_function(env, "abortNativeListenerOperation", NAPI_AUTO_LENGTH, abort_operation,
                           operation, &callback) != napi_ok ||
      napi_create_reference(env, owner, 1, &operation->owner_ref) != napi_ok ||
      napi_create_reference(env, signal, 1, &operation->signal_ref) != napi_ok ||
      napi_create_reference(env, callback, 1, &operation->abort_ref) != napi_ok ||
      napi_get_named_property(env, signal, "addEventListener", &method) != napi_ok ||
      napi_create_string_utf8(env, "abort", NAPI_AUTO_LENGTH, &event) != napi_ok ||
      napi_create_object(env, &options) != napi_ok || napi_get_boolean(env, true, &once) != napi_ok ||
      napi_set_named_property(env, options, "once", once) != napi_ok)
    return -1;
  arguments[0] = event;
  arguments[1] = callback;
  arguments[2] = options;
  napi_value ignored;
  if (napi_call_function(env, signal, method, 3, arguments, &ignored) != napi_ok)
    return -1;
  return 0;
}

static void detach_abort(struct async_operation *operation) {
  napi_env env = operation->env;
  napi_value signal;
  napi_value callback;
  napi_value method;
  napi_value event;
  napi_value arguments[2];
  napi_value ignored;
  if (operation->signal_ref != NULL && operation->abort_ref != NULL &&
      napi_get_reference_value(env, operation->signal_ref, &signal) == napi_ok &&
      napi_get_reference_value(env, operation->abort_ref, &callback) == napi_ok &&
      napi_get_named_property(env, signal, "removeEventListener", &method) == napi_ok &&
      napi_create_string_utf8(env, "abort", NAPI_AUTO_LENGTH, &event) == napi_ok) {
    arguments[0] = event;
    arguments[1] = callback;
    (void)napi_call_function(env, signal, method, 2, arguments, &ignored);
    clear_pending_exception(env);
  }
  if (operation->abort_ref != NULL)
    (void)napi_delete_reference(env, operation->abort_ref);
  if (operation->signal_ref != NULL)
    (void)napi_delete_reference(env, operation->signal_ref);
  if (operation->owner_ref != NULL)
    (void)napi_delete_reference(env, operation->owner_ref);
  operation->abort_ref = NULL;
  operation->signal_ref = NULL;
  operation->owner_ref = NULL;
  close_descriptor(&operation->cancellation[0]);
  close_descriptor(&operation->cancellation[1]);
}

static int wait_descriptor(struct async_operation *operation, int descriptor, short events) {
  struct pollfd descriptors[2] = {
      {.fd = descriptor, .events = events, .revents = 0},
      {.fd = operation->cancellation[0], .events = POLLIN, .revents = 0},
  };
  for (;;) {
    if (atomic_load_explicit(&operation->cancelled, memory_order_acquire)) {
      errno = ECANCELED;
      return -1;
    }
    int result = poll(descriptors, 2, -1);
    if (result < 0 && errno == EINTR)
      continue;
    if (result < 0)
      return -1;
    if ((descriptors[1].revents & (POLLIN | POLLERR | POLLHUP)) != 0 ||
        atomic_load_explicit(&operation->cancelled, memory_order_acquire)) {
      errno = ECANCELED;
      return -1;
    }
    if ((descriptors[0].revents & events) != 0 ||
        (operation->kind == OPERATION_READ && (descriptors[0].revents & POLLHUP) != 0))
      return 0;
    if ((descriptors[0].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
      errno = EIO;
      return -1;
    }
  }
}

static void execute_operation(napi_env env, void *data) {
  (void)env;
  struct async_operation *operation = data;
  operation->error_number = 0;
  if (operation->kind == OPERATION_ACCEPT) {
    for (;;) {
      if (wait_descriptor(operation, operation->listener->descriptor, POLLIN) != 0) {
        operation->error_number = errno;
        return;
      }
      operation->accepted_descriptor =
          accept4(operation->listener->descriptor, NULL, NULL, SOCK_CLOEXEC | SOCK_NONBLOCK);
      if (operation->accepted_descriptor >= 0)
        return;
      if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) {
        operation->error_number = errno;
        return;
      }
    }
  }
  if (operation->kind == OPERATION_READ) {
    operation->bytes = calloc(MAX_FRAME_BYTES + 1, 1);
    if (operation->bytes == NULL) {
      operation->error_number = ENOMEM;
      return;
    }
    while (operation->length <= MAX_FRAME_BYTES) {
      if (wait_descriptor(operation, operation->session->descriptor, POLLIN) != 0) {
        operation->error_number = errno;
        return;
      }
      ssize_t received = read(operation->session->descriptor, operation->bytes + operation->length,
                              MAX_FRAME_BYTES + 1 - operation->length);
      if (received < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK))
        continue;
      if (received < 0) {
        operation->error_number = errno;
        return;
      }
      if (received == 0)
        break;
      operation->length += (size_t)received;
    }
    if (operation->length < 3 || operation->length > MAX_FRAME_BYTES)
      operation->error_number = EMSGSIZE;
    return;
  }
  size_t offset = 0;
  while (offset < operation->length) {
    if (wait_descriptor(operation, operation->session->descriptor, POLLOUT) != 0) {
      operation->error_number = errno;
      return;
    }
    ssize_t written = send(operation->session->descriptor, operation->bytes + offset,
                           operation->length - offset, MSG_NOSIGNAL);
    if (written < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK))
      continue;
    if (written <= 0) {
      operation->error_number = written == 0 ? EIO : errno;
      return;
    }
    offset += (size_t)written;
  }
  if (shutdown(operation->session->descriptor, SHUT_WR) != 0)
    operation->error_number = errno;
}

static napi_value session_peer_credentials(napi_env env, napi_callback_info info);
static napi_value session_read(napi_env env, napi_callback_info info);
static napi_value session_write(napi_env env, napi_callback_info info);
static napi_value session_close(napi_env env, napi_callback_info info);

static napi_value create_session_value(napi_env env, struct async_operation *operation) {
  struct session_state *state = calloc(1, sizeof(*state));
  napi_value result;
  napi_value listener_object;
  if (state == NULL || napi_create_object(env, &result) != napi_ok ||
      napi_get_reference_value(env, operation->owner_ref, &listener_object) != napi_ok) {
    free(state);
    return NULL;
  }
  state->descriptor = operation->accepted_descriptor;
  operation->accepted_descriptor = -1;
  state->listener = operation->listener;
  if (napi_create_reference(env, listener_object, 1, &state->listener_ref) != napi_ok ||
      napi_wrap(env, result, state, finalize_session, NULL, NULL) != napi_ok) {
    (void)close_session_state(env, state);
    free(state);
    return NULL;
  }
  napi_property_descriptor methods[] = {
      {.utf8name = "peerCredentials", .method = session_peer_credentials,
       .attributes = napi_default_jsproperty},
      {.utf8name = "readToEof", .method = session_read, .attributes = napi_default_jsproperty},
      {.utf8name = "writeAndShutdown", .method = session_write,
       .attributes = napi_default_jsproperty},
      {.utf8name = "close", .method = session_close, .attributes = napi_default_jsproperty},
  };
  if (napi_define_properties(env, result, sizeof(methods) / sizeof(methods[0]), methods) != napi_ok) {
    void *removed = NULL;
    (void)napi_remove_wrap(env, result, &removed);
    (void)close_session_state(env, state);
    free(state);
    return NULL;
  }
  state->listener->session_active = true;
  return result;
}

static void free_operation(struct async_operation *operation) {
  if (operation->bytes != NULL) {
    clear_bytes(operation->bytes, operation->kind == OPERATION_READ ? MAX_FRAME_BYTES + 1
                                                                    : operation->length);
    free(operation->bytes);
  }
  clear_bytes(operation, sizeof(*operation));
  free(operation);
}

static void complete_operation(napi_env env, napi_status status, void *data) {
  struct async_operation *operation = data;
  if (operation->listener != NULL)
    operation->listener->operation_active = false;
  if (operation->session != NULL)
    operation->session->operation_active = false;
  bool failed = status != napi_ok || operation->error_number != 0 ||
                atomic_load_explicit(&operation->cancelled, memory_order_acquire);
  napi_value result = NULL;
  if (!failed && operation->kind == OPERATION_ACCEPT)
    result = create_session_value(env, operation);
  else if (!failed && operation->kind == OPERATION_READ &&
           napi_create_buffer_copy(env, operation->length, operation->bytes, NULL, &result) !=
               napi_ok)
    failed = true;
  else if (!failed && operation->kind == OPERATION_WRITE &&
           napi_get_undefined(env, &result) != napi_ok)
    failed = true;
  if (operation->kind == OPERATION_ACCEPT && result == NULL)
    failed = true;
  if (failed) {
    close_descriptor(&operation->accepted_descriptor);
    napi_value error;
    napi_value message;
    if (napi_create_string_utf8(env, DENIAL_MESSAGE, NAPI_AUTO_LENGTH, &message) == napi_ok &&
        napi_create_error(env, NULL, message, &error) == napi_ok)
      (void)napi_reject_deferred(env, operation->deferred, error);
  } else {
    (void)napi_resolve_deferred(env, operation->deferred, result);
  }
  detach_abort(operation);
  (void)napi_delete_async_work(env, operation->work);
  free_operation(operation);
}

static napi_value queue_operation(napi_env env, napi_value owner, napi_value signal,
                                  enum operation_kind kind, struct listener_state *listener,
                                  struct session_state *session, uint8_t *bytes, size_t length) {
  struct async_operation *operation = calloc(1, sizeof(*operation));
  napi_value promise;
  napi_value resource_name;
  if (operation == NULL) {
    clear_bytes(bytes, length);
    free(bytes);
    return deny(env);
  }
  operation->kind = kind;
  operation->env = env;
  operation->listener = listener;
  operation->session = session;
  operation->accepted_descriptor = -1;
  operation->cancellation[0] = -1;
  operation->cancellation[1] = -1;
  operation->bytes = bytes;
  operation->length = length;
  atomic_init(&operation->cancelled, false);
  if (attach_abort(env, operation, owner, signal) != 0 ||
      napi_create_promise(env, &operation->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "ventureosLinuxNativeListener", NAPI_AUTO_LENGTH,
                              &resource_name) != napi_ok ||
      napi_create_async_work(env, NULL, resource_name, execute_operation, complete_operation,
                             operation, &operation->work) != napi_ok ||
      napi_queue_async_work(env, operation->work) != napi_ok) {
    clear_pending_exception(env);
    detach_abort(operation);
    if (operation->work != NULL)
      (void)napi_delete_async_work(env, operation->work);
    free_operation(operation);
    return deny(env);
  }
  if (listener != NULL)
    listener->operation_active = true;
  if (session != NULL)
    session->operation_active = true;
  return promise;
}

static napi_value listener_creation_evidence(napi_env env, napi_callback_info info) {
  napi_value values[1];
  napi_value receiver;
  struct listener_state *state;
  napi_value result;
  if (exact_argc(env, info, 1, values, &receiver) != 0 ||
      get_listener(env, receiver, &state) != 0 || !state->active || state->creation_observed ||
      signal_is_aborted(env, values[0]) != 0 || napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "schemaVersion", 1) != 0 ||
      add_string(env, result, "pathStateBefore", "ABSENT") != 0 ||
      add_string(env, result, "bindDisposition", "CREATED_WITHOUT_REPLACEMENT") != 0 ||
      add_identity(env, result, "parentIdentity", &state->parent_identity, "DIRECTORY") != 0 ||
      add_identity(env, result, "listenerIdentity", &state->listener_identity, "SOCKET") != 0)
    return deny(env);
  state->creation_observed = true;
  return result;
}

static napi_value listener_lstat(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  struct listener_state *state;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  struct stat current;
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      get_listener(env, receiver, &state) != 0 || !state->active ||
      !state->creation_observed || exact_string(env, values[0], path, sizeof(path)) != 0 ||
      strcmp(path, state->path) != 0 || signal_is_aborted(env, values[1]) != 0 ||
      lstat(path, &current) != 0)
    return deny(env);
  napi_value result = identity_value(env, &current, S_ISSOCK(current.st_mode) ? "SOCKET" : "OTHER");
  return result == NULL ? deny(env) : result;
}

static napi_value listener_accept(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  struct listener_state *state;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      get_listener(env, receiver, &state) != 0 || !state->active ||
      !state->creation_observed || state->accept_consumed || state->operation_active ||
      state->session_active || exact_string(env, values[0], path, sizeof(path)) != 0 ||
      strcmp(path, state->path) != 0 || signal_is_aborted(env, values[1]) != 0)
    return deny(env);
  state->accept_consumed = true;
  return queue_operation(env, receiver, values[1], OPERATION_ACCEPT, state, NULL, NULL, 0);
}

static napi_value listener_cleanup(napi_env env, napi_callback_info info) {
  napi_value receiver;
  struct listener_state *state;
  struct stat current;
  const char *disposition = "OWNED_SOCKET_MISSING";
  bool listener_closed = true;
  if (exact_argc(env, info, 0, NULL, &receiver) != 0 ||
      get_listener(env, receiver, &state) != 0 || !state->active || state->operation_active ||
      state->session_active)
    return deny(env);
  int64_t expected_device = (int64_t)state->listener_identity.st_dev;
  int64_t expected_inode = (int64_t)state->listener_identity.st_ino;
  if (state->descriptor >= 0 && close(state->descriptor) != 0)
    listener_closed = false;
  state->descriptor = -1;
  if (!listener_closed) {
    disposition = "LISTENER_CLOSE_FAILED";
  } else if (lstat(state->path, &current) == 0) {
    if (same_identity(&state->listener_identity, &current))
      disposition = unlink(state->path) == 0 ? "OWNED_SOCKET_REMOVED" : "REMOVE_FAILED";
    else
      disposition = "SUBSTITUTION_PRESERVED";
  } else if (errno != ENOENT) {
    disposition = "LSTAT_FAILED";
  }
  state->active = false;
  napi_value result;
  if (napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "schemaVersion", 1) != 0 ||
      add_bool(env, result, "listenerClosed", listener_closed) != 0 ||
      add_string(env, result, "disposition", disposition) != 0 ||
      add_int64(env, result, "expectedDevice", expected_device) != 0 ||
      add_int64(env, result, "expectedInode", expected_inode) != 0)
    return deny(env);
  return result;
}

static napi_value session_peer_credentials(napi_env env, napi_callback_info info) {
  napi_value values[1];
  napi_value receiver;
  struct session_state *state;
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  napi_value result;
  if (exact_argc(env, info, 1, values, &receiver) != 0 ||
      get_session(env, receiver, &state) != 0 || state->phase != 0 ||
      state->operation_active || signal_is_aborted(env, values[0]) != 0 ||
      getsockopt(state->descriptor, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0 ||
      length != sizeof(credentials) || napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "pid", (int64_t)credentials.pid) != 0 ||
      add_int64(env, result, "uid", (int64_t)credentials.uid) != 0 ||
      add_int64(env, result, "gid", (int64_t)credentials.gid) != 0)
    return deny(env);
  state->phase = 1;
  return result;
}

static napi_value session_read(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  struct session_state *state;
  int64_t maximum = 0;
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      get_session(env, receiver, &state) != 0 || state->phase != 1 ||
      state->operation_active || napi_get_value_int64(env, values[0], &maximum) != napi_ok ||
      maximum != MAX_FRAME_BYTES || signal_is_aborted(env, values[1]) != 0)
    return deny(env);
  state->phase = 2;
  return queue_operation(env, receiver, values[1], OPERATION_READ, NULL, state, NULL, 0);
}

static napi_value session_write(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  struct session_state *state;
  bool is_buffer = false;
  void *source = NULL;
  size_t length = 0;
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      get_session(env, receiver, &state) != 0 || state->phase != 2 ||
      state->operation_active || napi_is_buffer(env, values[0], &is_buffer) != napi_ok ||
      !is_buffer || napi_get_buffer_info(env, values[0], &source, &length) != napi_ok ||
      source == NULL || length < 3 || length > MAX_FRAME_BYTES ||
      signal_is_aborted(env, values[1]) != 0)
    return deny(env);
  uint8_t *owned = malloc(length);
  if (owned == NULL)
    return deny(env);
  memcpy(owned, source, length);
  state->phase = 3;
  return queue_operation(env, receiver, values[1], OPERATION_WRITE, NULL, state, owned, length);
}

static napi_value session_close(napi_env env, napi_callback_info info) {
  napi_value receiver;
  struct session_state *state;
  napi_value result;
  if (exact_argc(env, info, 0, NULL, &receiver) != 0 ||
      get_session(env, receiver, &state) != 0 || state->operation_active || state->descriptor < 0)
    return deny(env);
  int close_failed = close_session_state(env, state);
  if (close_failed != 0)
    return deny(env);
  return napi_get_undefined(env, &result) == napi_ok ? result : NULL;
}

static napi_value create_owned_listener(napi_env env, napi_callback_info info) {
  napi_value values[2];
  int64_t schema_version = 0;
  int64_t socket_mode = 0;
  int64_t listen_backlog = 0;
  napi_value socket_path_value;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  char parent_path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  struct stat existing;
  struct stat created_identity;
  struct stat secured_identity;
  struct stat current_parent;
  struct listener_state *state = NULL;
  char *separator;
  if (exact_argc(env, info, 2, values, NULL) != 0 || signal_is_aborted(env, values[1]) != 0 ||
      named_int64(env, values[0], "schemaVersion", &schema_version) != 0 ||
      schema_version != 1 || named_exact_string(env, values[0], "platform", "LINUX") != 0 ||
      named_value(env, values[0], "socketPath", &socket_path_value) != 0 ||
      exact_string(env, socket_path_value, path, sizeof(path)) != 0 ||
      named_int64(env, values[0], "socketMode", &socket_mode) != 0 || socket_mode != 0600 ||
      named_int64(env, values[0], "listenBacklog", &listen_backlog) != 0 ||
      listen_backlog != 1 ||
      named_exact_string(env, values[0], "pathDisposition", "FAIL_IF_PRESENT") != 0)
    return deny(env);
  memcpy(parent_path, path, strlen(path) + 1);
  separator = strrchr(parent_path, '/');
  if (separator == NULL)
    return deny(env);
  if (separator == parent_path)
    separator[1] = '\0';
  else
    *separator = '\0';
  state = calloc(1, sizeof(*state));
  if (state == NULL)
    return deny(env);
  state->descriptor = -1;
  if (lstat(parent_path, &state->parent_identity) != 0 ||
      !S_ISDIR(state->parent_identity.st_mode) ||
      (state->parent_identity.st_mode & 0777) != 0700 || lstat(path, &existing) == 0 ||
      errno != ENOENT || !safe_stat(&state->parent_identity))
    goto denied;
  state->descriptor = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
  if (state->descriptor < 0)
    goto denied;
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, path, strlen(path) + 1);
  socklen_t address_length = (socklen_t)(offsetof(struct sockaddr_un, sun_path) + strlen(path) + 1);
  if (bind(state->descriptor, (struct sockaddr *)&address, address_length) != 0)
    goto denied;
  state->active = true;
  memcpy(state->path, path, strlen(path) + 1);
  if (lstat(path, &created_identity) != 0 || !S_ISSOCK(created_identity.st_mode) ||
      !safe_stat(&created_identity))
    goto denied;
  state->listener_identity = created_identity;
  if (chmod(path, 0600) != 0)
    goto denied;
  state->listener_identity.st_mode =
      (state->listener_identity.st_mode & (mode_t)~0777) | (mode_t)0600;
  if (lstat(path, &secured_identity) != 0 || !S_ISSOCK(secured_identity.st_mode) ||
      (secured_identity.st_mode & 0777) != 0600 ||
      secured_identity.st_dev != created_identity.st_dev ||
      secured_identity.st_ino != created_identity.st_ino ||
      secured_identity.st_uid != created_identity.st_uid ||
      secured_identity.st_gid != created_identity.st_gid || !safe_stat(&secured_identity) ||
      lstat(parent_path, &current_parent) != 0 ||
      !same_directory_identity(&state->parent_identity, &current_parent) ||
      listen(state->descriptor, 1) != 0)
    goto denied;
  state->listener_identity = secured_identity;
  napi_value result;
  napi_value listener_platform;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_string_utf8(env, "LINUX", NAPI_AUTO_LENGTH, &listener_platform) != napi_ok ||
      napi_wrap(env, result, state, finalize_listener, NULL, NULL) != napi_ok)
    goto denied;
  napi_property_descriptor properties[] = {
      {.utf8name = "platform", .value = listener_platform,
       .attributes = napi_default_jsproperty},
      {.utf8name = "creationEvidence", .method = listener_creation_evidence,
       .attributes = napi_default_jsproperty},
      {.utf8name = "lstatUnixSocket", .method = listener_lstat,
       .attributes = napi_default_jsproperty},
      {.utf8name = "acceptAuthorizedUnixSocket", .method = listener_accept,
       .attributes = napi_default_jsproperty},
      {.utf8name = "closeAndUnlinkOwned", .method = listener_cleanup,
       .attributes = napi_default_jsproperty},
  };
  if (napi_define_properties(env, result, sizeof(properties) / sizeof(properties[0]), properties) !=
      napi_ok) {
    void *removed = NULL;
    (void)napi_remove_wrap(env, result, &removed);
    goto denied;
  }
  return result;

denied:
  cleanup_listener_state(state);
  clear_bytes(state, sizeof(*state));
  free(state);
  return deny(env);
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value abi_version;
  napi_value platform;
  napi_value create;
  if (napi_create_int64(env, 1, &abi_version) != napi_ok ||
      napi_create_string_utf8(env, "LINUX", NAPI_AUTO_LENGTH, &platform) != napi_ok ||
      napi_create_function(env, "createOwnedListener", NAPI_AUTO_LENGTH, create_owned_listener,
                           NULL, &create) != napi_ok)
    return NULL;
  napi_property_descriptor properties[] = {
      {.utf8name = "abiVersion", .value = abi_version, .attributes = napi_default_jsproperty},
      {.utf8name = "platform", .value = platform, .attributes = napi_default_jsproperty},
      {.utf8name = "createOwnedListener", .value = create,
       .attributes = napi_default_jsproperty},
  };
  return napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]),
                                properties) == napi_ok
             ? exports
             : NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
