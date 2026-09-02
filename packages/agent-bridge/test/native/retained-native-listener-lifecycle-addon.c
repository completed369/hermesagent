#define _GNU_SOURCE
#define NAPI_VERSION 8

#include <errno.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#define MAX_FRAME_BYTES 32768

struct listener_fixture_state {
  int listener;
  int client;
  int accepted;
  int active;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  struct stat parent_identity;
  struct stat listener_identity;
};

static struct listener_fixture_state fixture_state = {
    .listener = -1,
    .client = -1,
    .accepted = -1,
};

static napi_value deny(napi_env env) {
  (void)napi_throw_error(env, "RETAINED_NATIVE_LISTENER_LIFECYCLE_DENIED",
                         "Retained native listener lifecycle evidence denied");
  return NULL;
}

static int exact_argc(napi_env env, napi_callback_info info, size_t expected,
                      napi_value *values) {
  size_t actual = 0;
  if (napi_get_cb_info(env, info, &actual, NULL, NULL, NULL) != napi_ok || actual != expected)
    return -1;
  actual = expected;
  return napi_get_cb_info(env, info, &actual, values, NULL, NULL) == napi_ok && actual == expected
             ? 0
             : -1;
}

static int exact_string(napi_env env, napi_value value, char *output, size_t capacity) {
  napi_valuetype type;
  size_t required = 0;
  size_t copied = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, value, NULL, 0, &required) != napi_ok || required < 2 ||
      required >= capacity ||
      napi_get_value_string_utf8(env, value, output, capacity, &copied) != napi_ok ||
      copied != required || output[0] != '/' || memchr(output, '\0', copied) != NULL)
    return -1;
  return 0;
}

static int exact_buffer(napi_env env, napi_value value, uint8_t **data, size_t *length) {
  bool is_buffer = false;
  void *raw = NULL;
  if (napi_is_buffer(env, value, &is_buffer) != napi_ok || !is_buffer ||
      napi_get_buffer_info(env, value, &raw, length) != napi_ok || raw == NULL || *length < 3 ||
      *length > MAX_FRAME_BYTES)
    return -1;
  *data = raw;
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

static int write_all(int descriptor, const uint8_t *data, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(descriptor, data + offset, length - offset);
    if (written < 0 && errno == EINTR)
      continue;
    if (written <= 0)
      return -1;
    offset += (size_t)written;
  }
  return 0;
}

static void clear_bytes(void *data, size_t length) {
  volatile uint8_t *cursor = data;
  while (length > 0) {
    length -= 1;
    cursor[length] = 0;
  }
}

static int close_session_state(void) {
  int failed = 0;
  if (fixture_state.accepted >= 0 && close(fixture_state.accepted) != 0)
    failed = -1;
  if (fixture_state.client >= 0 && close(fixture_state.client) != 0)
    failed = -1;
  fixture_state.accepted = -1;
  fixture_state.client = -1;
  return failed;
}

static void reset_state(void) {
  fixture_state.listener = -1;
  fixture_state.active = 0;
  fixture_state.path[0] = '\0';
  memset(&fixture_state.parent_identity, 0, sizeof(fixture_state.parent_identity));
  memset(&fixture_state.listener_identity, 0, sizeof(fixture_state.listener_identity));
}

static void cleanup_environment(void *ignored) {
  struct stat current;
  (void)ignored;
  (void)close_session_state();
  if (fixture_state.listener >= 0)
    (void)close(fixture_state.listener);
  if (fixture_state.active && fixture_state.path[0] != '\0' &&
      lstat(fixture_state.path, &current) == 0 &&
      same_identity(&fixture_state.listener_identity, &current))
    (void)unlink(fixture_state.path);
  reset_state();
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
  if (napi_create_object(env, &value) != napi_ok ||
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

static napi_value create_listener(napi_env env, napi_callback_info info) {
  napi_value values[1];
  char path[sizeof(fixture_state.path)];
  char parent_path[sizeof(fixture_state.path)];
  struct stat existing;
  struct stat created;
  struct stat secured;
  struct stat current_parent;
  char *separator;
  if (fixture_state.active || exact_argc(env, info, 1, values) != 0 ||
      exact_string(env, values[0], path, sizeof(path)) != 0)
    return deny(env);
  memcpy(parent_path, path, strlen(path) + 1);
  separator = strrchr(parent_path, '/');
  if (separator == NULL)
    return deny(env);
  if (separator == parent_path)
    separator[1] = '\0';
  else
    *separator = '\0';
  if (lstat(parent_path, &fixture_state.parent_identity) != 0 ||
      !S_ISDIR(fixture_state.parent_identity.st_mode) ||
      (fixture_state.parent_identity.st_mode & 0777) != 0700 || lstat(path, &existing) == 0 ||
      errno != ENOENT)
    return deny(env);

  int listener = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (listener < 0)
    return deny(env);
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, path, strlen(path) + 1);
  if (bind(listener, (struct sockaddr *)&address, sizeof(address)) != 0) {
    (void)close(listener);
    return deny(env);
  }
  fixture_state.listener = listener;
  fixture_state.active = 1;
  memcpy(fixture_state.path, path, strlen(path) + 1);
  if (lstat(path, &created) != 0 || !S_ISSOCK(created.st_mode)) {
    cleanup_environment(NULL);
    return deny(env);
  }
  fixture_state.listener_identity = created;
  if (chmod(path, 0600) != 0 || lstat(path, &secured) != 0 ||
      !S_ISSOCK(secured.st_mode) || (secured.st_mode & 0777) != 0600 ||
      secured.st_dev != created.st_dev || secured.st_ino != created.st_ino ||
      lstat(parent_path, &current_parent) != 0 ||
      !same_directory_identity(&fixture_state.parent_identity, &current_parent)) {
    cleanup_environment(NULL);
    return deny(env);
  }
  fixture_state.listener_identity = secured;
  if (listen(listener, 1) != 0) {
    cleanup_environment(NULL);
    return deny(env);
  }

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "schemaVersion", 1) != 0 ||
      add_string(env, result, "pathStateBefore", "ABSENT") != 0 ||
      add_string(env, result, "bindDisposition", "CREATED_WITHOUT_REPLACEMENT") != 0 ||
      add_identity(env, result, "parentIdentity", &fixture_state.parent_identity, "DIRECTORY") !=
          0 ||
      add_identity(env, result, "listenerIdentity", &fixture_state.listener_identity, "SOCKET") !=
          0) {
    cleanup_environment(NULL);
    return deny(env);
  }
  return result;
}

static napi_value lstat_listener(napi_env env, napi_callback_info info) {
  napi_value values[1];
  char path[sizeof(fixture_state.path)];
  struct stat current;
  napi_value result;
  if (!fixture_state.active || exact_argc(env, info, 1, values) != 0 ||
      exact_string(env, values[0], path, sizeof(path)) != 0 ||
      strcmp(path, fixture_state.path) != 0 || lstat(path, &current) != 0 ||
      napi_create_object(env, &result) != napi_ok ||
      add_string(env, result, "fileType", S_ISSOCK(current.st_mode) ? "SOCKET" : "OTHER") != 0 ||
      add_int64(env, result, "device", (int64_t)current.st_dev) != 0 ||
      add_int64(env, result, "inode", (int64_t)current.st_ino) != 0 ||
      add_int64(env, result, "ownerUid", (int64_t)current.st_uid) != 0 ||
      add_int64(env, result, "ownerGid", (int64_t)current.st_gid) != 0 ||
      add_int64(env, result, "mode", (int64_t)(current.st_mode & 0777)) != 0)
    return deny(env);
  return result;
}

static napi_value begin_session(napi_env env, napi_callback_info info) {
  napi_value values[1];
  uint8_t *request = NULL;
  size_t request_length = 0;
  struct stat current;
  if (!fixture_state.active || fixture_state.client >= 0 || fixture_state.accepted >= 0 ||
      exact_argc(env, info, 1, values) != 0 ||
      exact_buffer(env, values[0], &request, &request_length) != 0 ||
      lstat(fixture_state.path, &current) != 0 ||
      !same_identity(&fixture_state.listener_identity, &current))
    return deny(env);

  int client = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, fixture_state.path, strlen(fixture_state.path) + 1);
  if (client < 0 || connect(client, (struct sockaddr *)&address, sizeof(address)) != 0 ||
      write_all(client, request, request_length) != 0 || shutdown(client, SHUT_WR) != 0) {
    if (client >= 0)
      (void)close(client);
    return deny(env);
  }
  int accepted = accept4(fixture_state.listener, NULL, NULL, SOCK_CLOEXEC);
  if (accepted < 0) {
    (void)close(client);
    return deny(env);
  }
  fixture_state.client = client;
  fixture_state.accepted = accepted;
  napi_value result;
  if (napi_get_undefined(env, &result) != napi_ok) {
    (void)close_session_state();
    return deny(env);
  }
  return result;
}

static napi_value peer_credentials(napi_env env, napi_callback_info info) {
  struct ucred credentials;
  socklen_t length = sizeof(credentials);
  napi_value result;
  if (exact_argc(env, info, 0, NULL) != 0 || fixture_state.accepted < 0 ||
      getsockopt(fixture_state.accepted, SOL_SOCKET, SO_PEERCRED, &credentials, &length) != 0 ||
      length != sizeof(credentials) || napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "pid", (int64_t)credentials.pid) != 0 ||
      add_int64(env, result, "uid", (int64_t)credentials.uid) != 0 ||
      add_int64(env, result, "gid", (int64_t)credentials.gid) != 0)
    return deny(env);
  return result;
}

static napi_value read_request(napi_env env, napi_callback_info info) {
  napi_value values[1];
  int64_t maximum = 0;
  uint8_t buffer[MAX_FRAME_BYTES + 1];
  size_t total = 0;
  napi_value result;
  if (fixture_state.accepted < 0 || exact_argc(env, info, 1, values) != 0 ||
      napi_get_value_int64(env, values[0], &maximum) != napi_ok || maximum != MAX_FRAME_BYTES)
    return deny(env);
  while (total <= MAX_FRAME_BYTES) {
    ssize_t received = read(fixture_state.accepted, buffer + total, sizeof(buffer) - total);
    if (received < 0 && errno == EINTR)
      continue;
    if (received < 0)
      goto denied;
    if (received == 0)
      break;
    total += (size_t)received;
  }
  if (total < 3 || total > MAX_FRAME_BYTES ||
      napi_create_buffer_copy(env, total, buffer, NULL, &result) != napi_ok)
    goto denied;
  clear_bytes(buffer, sizeof(buffer));
  return result;

denied:
  clear_bytes(buffer, sizeof(buffer));
  return deny(env);
}

static napi_value write_response(napi_env env, napi_callback_info info) {
  napi_value values[1];
  uint8_t *response = NULL;
  size_t response_length = 0;
  uint8_t observed[MAX_FRAME_BYTES + 1];
  size_t total = 0;
  napi_value result;
  if (fixture_state.accepted < 0 || fixture_state.client < 0 ||
      exact_argc(env, info, 1, values) != 0 ||
      exact_buffer(env, values[0], &response, &response_length) != 0 ||
      write_all(fixture_state.accepted, response, response_length) != 0 ||
      shutdown(fixture_state.accepted, SHUT_WR) != 0)
    return deny(env);
  while (total <= MAX_FRAME_BYTES) {
    ssize_t received = read(fixture_state.client, observed + total, sizeof(observed) - total);
    if (received < 0 && errno == EINTR)
      continue;
    if (received < 0)
      goto denied;
    if (received == 0)
      break;
    total += (size_t)received;
  }
  if (total != response_length || memcmp(observed, response, response_length) != 0 ||
      napi_create_buffer_copy(env, total, observed, NULL, &result) != napi_ok)
    goto denied;
  clear_bytes(observed, sizeof(observed));
  return result;

denied:
  clear_bytes(observed, sizeof(observed));
  return deny(env);
}

static napi_value close_session(napi_env env, napi_callback_info info) {
  napi_value result;
  if (exact_argc(env, info, 0, NULL) != 0)
    return deny(env);
  if (close_session_state() != 0)
    return deny(env);
  if (napi_get_undefined(env, &result) != napi_ok)
    return deny(env);
  return result;
}

static napi_value cleanup_listener(napi_env env, napi_callback_info info) {
  struct stat current;
  const char *disposition = "OWNED_SOCKET_MISSING";
  bool listener_closed = true;
  int64_t expected_device;
  int64_t expected_inode;
  napi_value result;
  if (!fixture_state.active || exact_argc(env, info, 0, NULL) != 0)
    return deny(env);
  expected_device = (int64_t)fixture_state.listener_identity.st_dev;
  expected_inode = (int64_t)fixture_state.listener_identity.st_ino;
  (void)close_session_state();
  if (fixture_state.listener >= 0 && close(fixture_state.listener) != 0)
    listener_closed = false;
  fixture_state.listener = -1;
  if (!listener_closed) {
    disposition = "LISTENER_CLOSE_FAILED";
  } else if (lstat(fixture_state.path, &current) == 0) {
    if (same_identity(&fixture_state.listener_identity, &current)) {
      disposition = unlink(fixture_state.path) == 0 ? "OWNED_SOCKET_REMOVED" : "REMOVE_FAILED";
    } else {
      disposition = "SUBSTITUTION_PRESERVED";
    }
  } else if (errno != ENOENT) {
    disposition = "LSTAT_FAILED";
  }
  if (napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "schemaVersion", 1) != 0 ||
      add_bool(env, result, "listenerClosed", listener_closed) != 0 ||
      add_string(env, result, "disposition", disposition) != 0 ||
      add_int64(env, result, "expectedDevice", expected_device) != 0 ||
      add_int64(env, result, "expectedInode", expected_inode) != 0) {
    reset_state();
    return deny(env);
  }
  reset_state();
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  const char *names[] = {"create",       "lstat",        "beginSession", "peerCredentials",
                         "readRequest",  "writeResponse", "closeSession", "cleanup"};
  napi_callback callbacks[] = {create_listener,  lstat_listener, begin_session, peer_credentials,
                               read_request,     write_response, close_session, cleanup_listener};
  if (napi_add_env_cleanup_hook(env, cleanup_environment, NULL) != napi_ok)
    return NULL;
  for (size_t index = 0; index < sizeof(callbacks) / sizeof(callbacks[0]); index += 1) {
    napi_value function;
    if (napi_create_function(env, names[index], NAPI_AUTO_LENGTH, callbacks[index], NULL,
                             &function) != napi_ok ||
        napi_set_named_property(env, exports, names[index], function) != napi_ok)
      return NULL;
  }
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
