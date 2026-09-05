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
#define DENIAL_CODE "VENTUREOS_NATIVE_CLIENT_DENIED"
#define DENIAL_MESSAGE "VentureOS native client operation denied"

struct connection_state {
  int descriptor;
  int phase;
  bool operation_active;
};

enum operation_kind { OPERATION_CONNECT, OPERATION_WRITE, OPERATION_READ };

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
  int connected_descriptor;
  struct connection_state *connection;
  uint8_t *bytes;
  size_t length;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
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

static void close_descriptor(int *descriptor) {
  if (*descriptor >= 0)
    (void)close(*descriptor);
  *descriptor = -1;
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

static int add_string(napi_env env, napi_value object, const char *name, const char *value) {
  napi_value field;
  return napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &field) == napi_ok &&
                 napi_set_named_property(env, object, name, field) == napi_ok
             ? 0
             : -1;
}

static napi_value socket_identity(napi_env env, const struct stat *identity) {
  napi_value result;
  if (!safe_stat(identity) || !S_ISSOCK(identity->st_mode) ||
      napi_create_object(env, &result) != napi_ok ||
      add_string(env, result, "fileType", "SOCKET") != 0 ||
      add_int64(env, result, "device", (int64_t)identity->st_dev) != 0 ||
      add_int64(env, result, "inode", (int64_t)identity->st_ino) != 0 ||
      add_int64(env, result, "ownerUid", (int64_t)identity->st_uid) != 0 ||
      add_int64(env, result, "ownerGid", (int64_t)identity->st_gid) != 0 ||
      add_int64(env, result, "mode", (int64_t)(identity->st_mode & 0777)) != 0)
    return NULL;
  return result;
}

static void close_connection_state(struct connection_state *state) {
  if (state == NULL)
    return;
  close_descriptor(&state->descriptor);
  state->phase = 4;
}

static void finalize_connection(napi_env env, void *data, void *hint) {
  (void)env;
  (void)hint;
  struct connection_state *state = data;
  close_connection_state(state);
  clear_bytes(state, sizeof(*state));
  free(state);
}

static int get_connection(napi_env env, napi_value receiver, struct connection_state **state) {
  return napi_unwrap(env, receiver, (void **)state) == napi_ok && *state != NULL ? 0 : -1;
}

static napi_value abort_operation(napi_env env, napi_callback_info info) {
  void *data = NULL;
  size_t argc = 1;
  napi_value event;
  if (napi_get_cb_info(env, info, &argc, &event, NULL, &data) != napi_ok || argc != 1 ||
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
  if (signal_is_aborted(env, signal) != 0 ||
      pipe2(operation->cancellation, O_CLOEXEC | O_NONBLOCK) != 0 ||
      napi_create_function(env, "abortNativeClientOperation", NAPI_AUTO_LENGTH, abort_operation,
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
  return napi_call_function(env, signal, method, 3, arguments, &ignored) == napi_ok ? 0 : -1;
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

static int wait_descriptor(struct async_operation *operation, int descriptor, short events,
                           bool allow_hangup) {
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
        (allow_hangup && (descriptors[0].revents & POLLHUP) != 0))
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
  if (operation->kind == OPERATION_CONNECT) {
    operation->connected_descriptor =
        socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (operation->connected_descriptor < 0) {
      operation->error_number = errno;
      return;
    }
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path, operation->path, strlen(operation->path) + 1);
    socklen_t address_length =
        (socklen_t)(offsetof(struct sockaddr_un, sun_path) + strlen(operation->path) + 1);
    if (connect(operation->connected_descriptor, (struct sockaddr *)&address, address_length) == 0)
      return;
    if (errno != EINPROGRESS) {
      operation->error_number = errno;
      return;
    }
    if (wait_descriptor(operation, operation->connected_descriptor, POLLOUT, false) != 0) {
      operation->error_number = errno;
      return;
    }
    int socket_error = 0;
    socklen_t socket_error_length = sizeof(socket_error);
    if (getsockopt(operation->connected_descriptor, SOL_SOCKET, SO_ERROR, &socket_error,
                   &socket_error_length) != 0 ||
        socket_error_length != sizeof(socket_error) || socket_error != 0) {
      operation->error_number = socket_error != 0 ? socket_error : EIO;
    }
    return;
  }
  if (operation->kind == OPERATION_WRITE) {
    size_t offset = 0;
    while (offset < operation->length) {
      if (wait_descriptor(operation, operation->connection->descriptor, POLLOUT, false) != 0) {
        operation->error_number = errno;
        return;
      }
      ssize_t written = send(operation->connection->descriptor, operation->bytes + offset,
                             operation->length - offset, MSG_NOSIGNAL);
      if (written < 0 && (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK))
        continue;
      if (written <= 0) {
        operation->error_number = written == 0 ? EIO : errno;
        return;
      }
      offset += (size_t)written;
    }
    if (shutdown(operation->connection->descriptor, SHUT_WR) != 0)
      operation->error_number = errno;
    return;
  }
  operation->bytes = calloc(MAX_FRAME_BYTES + 1, 1);
  if (operation->bytes == NULL) {
    operation->error_number = ENOMEM;
    return;
  }
  while (operation->length <= MAX_FRAME_BYTES) {
    if (wait_descriptor(operation, operation->connection->descriptor, POLLIN, true) != 0) {
      operation->error_number = errno;
      return;
    }
    ssize_t received = read(operation->connection->descriptor, operation->bytes + operation->length,
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
}

static napi_value connection_peer_credentials(napi_env env, napi_callback_info info);
static napi_value connection_write(napi_env env, napi_callback_info info);
static napi_value connection_read(napi_env env, napi_callback_info info);
static napi_value connection_close(napi_env env, napi_callback_info info);

static napi_value create_connection_value(napi_env env, struct async_operation *operation) {
  struct connection_state *state = calloc(1, sizeof(*state));
  napi_value result;
  if (state == NULL || napi_create_object(env, &result) != napi_ok) {
    free(state);
    return NULL;
  }
  state->descriptor = operation->connected_descriptor;
  operation->connected_descriptor = -1;
  if (napi_wrap(env, result, state, finalize_connection, NULL, NULL) != napi_ok) {
    close_connection_state(state);
    free(state);
    return NULL;
  }
  napi_property_descriptor methods[] = {
      {.utf8name = "peerCredentials", .method = connection_peer_credentials,
       .attributes = napi_default_jsproperty},
      {.utf8name = "writeAndShutdown", .method = connection_write,
       .attributes = napi_default_jsproperty},
      {.utf8name = "readToEof", .method = connection_read,
       .attributes = napi_default_jsproperty},
      {.utf8name = "close", .method = connection_close, .attributes = napi_default_jsproperty},
  };
  if (napi_define_properties(env, result, sizeof(methods) / sizeof(methods[0]), methods) != napi_ok) {
    void *removed = NULL;
    (void)napi_remove_wrap(env, result, &removed);
    close_connection_state(state);
    free(state);
    return NULL;
  }
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
  if (operation->connection != NULL)
    operation->connection->operation_active = false;
  bool failed = status != napi_ok || operation->error_number != 0 ||
                atomic_load_explicit(&operation->cancelled, memory_order_acquire);
  napi_value result = NULL;
  if (!failed && operation->kind == OPERATION_CONNECT)
    result = create_connection_value(env, operation);
  else if (!failed && operation->kind == OPERATION_WRITE) {
    operation->connection->phase = 2;
    if (napi_get_undefined(env, &result) != napi_ok)
      failed = true;
  } else if (!failed && operation->kind == OPERATION_READ) {
    operation->connection->phase = 3;
    if (napi_create_buffer_copy(env, operation->length, operation->bytes, NULL, &result) != napi_ok)
      failed = true;
  }
  if (result == NULL)
    failed = true;
  if (failed) {
    close_descriptor(&operation->connected_descriptor);
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
                                  enum operation_kind kind, struct connection_state *connection,
                                  const char *path, uint8_t *bytes, size_t length) {
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
  operation->connection = connection;
  operation->connected_descriptor = -1;
  operation->cancellation[0] = -1;
  operation->cancellation[1] = -1;
  operation->bytes = bytes;
  operation->length = length;
  if (path != NULL)
    memcpy(operation->path, path, strlen(path) + 1);
  atomic_init(&operation->cancelled, false);
  if (attach_abort(env, operation, owner, signal) != 0 ||
      napi_create_promise(env, &operation->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "ventureosLinuxNativeClient", NAPI_AUTO_LENGTH,
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
  if (connection != NULL)
    connection->operation_active = true;
  return promise;
}

static napi_value lstat_unix_socket(napi_env env, napi_callback_info info) {
  napi_value values[2];
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  struct stat identity;
  napi_value result;
  if (exact_argc(env, info, 2, values, NULL) != 0 ||
      exact_string(env, values[0], path, sizeof(path)) != 0 ||
      signal_is_aborted(env, values[1]) != 0 || lstat(path, &identity) != 0 ||
      !S_ISSOCK(identity.st_mode) || (identity.st_mode & 0777) != 0600)
    return deny(env);
  result = socket_identity(env, &identity);
  return result != NULL ? result : deny(env);
}

static napi_value connect_unix_socket(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      exact_string(env, values[0], path, sizeof(path)) != 0 ||
      signal_is_aborted(env, values[1]) != 0)
    return deny(env);
  return queue_operation(env, receiver, values[1], OPERATION_CONNECT, NULL, path, NULL, 0);
}

static napi_value connection_peer_credentials(napi_env env, napi_callback_info info) {
  napi_value values[1];
  napi_value receiver;
  struct connection_state *state;
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  napi_value result;
  if (exact_argc(env, info, 1, values, &receiver) != 0 ||
      get_connection(env, receiver, &state) != 0 || state->phase != 0 ||
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

static napi_value connection_write(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  struct connection_state *state;
  bool is_buffer = false;
  void *source = NULL;
  size_t length = 0;
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      get_connection(env, receiver, &state) != 0 || state->phase != 1 ||
      state->operation_active || napi_is_buffer(env, values[0], &is_buffer) != napi_ok ||
      !is_buffer || napi_get_buffer_info(env, values[0], &source, &length) != napi_ok ||
      source == NULL || length < 3 || length > MAX_FRAME_BYTES ||
      signal_is_aborted(env, values[1]) != 0)
    return deny(env);
  uint8_t *owned = malloc(length);
  if (owned == NULL)
    return deny(env);
  memcpy(owned, source, length);
  return queue_operation(env, receiver, values[1], OPERATION_WRITE, state, NULL, owned, length);
}

static napi_value connection_read(napi_env env, napi_callback_info info) {
  napi_value values[2];
  napi_value receiver;
  struct connection_state *state;
  int64_t maximum = 0;
  if (exact_argc(env, info, 2, values, &receiver) != 0 ||
      get_connection(env, receiver, &state) != 0 || state->phase != 2 ||
      state->operation_active || napi_get_value_int64(env, values[0], &maximum) != napi_ok ||
      maximum != MAX_FRAME_BYTES || signal_is_aborted(env, values[1]) != 0)
    return deny(env);
  return queue_operation(env, receiver, values[1], OPERATION_READ, state, NULL, NULL, 0);
}

static napi_value connection_close(napi_env env, napi_callback_info info) {
  napi_value receiver;
  struct connection_state *state;
  napi_value result;
  if (exact_argc(env, info, 0, NULL, &receiver) != 0 ||
      get_connection(env, receiver, &state) != 0 || state->operation_active ||
      state->descriptor < 0)
    return deny(env);
  if (close(state->descriptor) != 0) {
    state->descriptor = -1;
    state->phase = 4;
    return deny(env);
  }
  state->descriptor = -1;
  state->phase = 4;
  return napi_get_undefined(env, &result) == napi_ok ? result : NULL;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value abi_version;
  napi_value platform;
  napi_value lstat_method;
  napi_value connect_method;
  if (napi_create_int64(env, 1, &abi_version) != napi_ok ||
      napi_create_string_utf8(env, "LINUX", NAPI_AUTO_LENGTH, &platform) != napi_ok ||
      napi_create_function(env, "lstatUnixSocket", NAPI_AUTO_LENGTH, lstat_unix_socket, NULL,
                           &lstat_method) != napi_ok ||
      napi_create_function(env, "connectUnixSocket", NAPI_AUTO_LENGTH, connect_unix_socket, NULL,
                           &connect_method) != napi_ok)
    return NULL;
  napi_property_descriptor properties[] = {
      {.utf8name = "abiVersion", .value = abi_version, .attributes = napi_default_jsproperty},
      {.utf8name = "platform", .value = platform, .attributes = napi_default_jsproperty},
      {.utf8name = "lstatUnixSocket", .value = lstat_method,
       .attributes = napi_default_jsproperty},
      {.utf8name = "connectUnixSocket", .value = connect_method,
       .attributes = napi_default_jsproperty},
  };
  return napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]),
                                properties) == napi_ok
             ? exports
             : NULL;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
