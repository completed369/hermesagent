#define _GNU_SOURCE
#define NAPI_VERSION 8

#include <errno.h>
#include <node_api.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#define MAX_FRAME_BYTES 32768

struct ipc_fixture_state {
  int listener;
  int active;
  char path[sizeof(((struct sockaddr_un *)0)->sun_path)];
  struct stat identity;
};

static struct ipc_fixture_state fixture_state = {.listener = -1};

static napi_value deny(napi_env env) {
  (void)napi_throw_error(env, "RETAINED_NATIVE_LOCAL_IPC_DENIED",
                         "Retained native local IPC evidence denied");
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

static int same_node(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_uid == right->st_uid && left->st_gid == right->st_gid &&
         S_ISSOCK(left->st_mode) && S_ISSOCK(right->st_mode);
}

static int same_identity(const struct stat *left, const struct stat *right) {
  return same_node(left, right) && (left->st_mode & 0777) == (right->st_mode & 0777);
}

static void unlink_owned(void) {
  struct stat current;
  if (fixture_state.path[0] != '\0' && lstat(fixture_state.path, &current) == 0 &&
      same_node(&fixture_state.identity, &current))
    (void)unlink(fixture_state.path);
}

static void close_state(void) {
  if (fixture_state.listener >= 0)
    (void)close(fixture_state.listener);
  fixture_state.listener = -1;
  unlink_owned();
  fixture_state.active = 0;
  fixture_state.path[0] = '\0';
  memset(&fixture_state.identity, 0, sizeof(fixture_state.identity));
}

static void environment_cleanup(void *ignored) {
  (void)ignored;
  close_state();
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

static int add_endpoint(napi_env env, napi_value object, const char *name,
                        const struct stat *identity) {
  napi_value endpoint;
  if (napi_create_object(env, &endpoint) != napi_ok ||
      add_int64(env, endpoint, "schemaVersion", 1) != 0 ||
      add_string(env, endpoint, "platform", "LINUX") != 0 ||
      add_string(env, endpoint, "authority", "LINUX_LSTAT_UNIX_SOCKET") != 0 ||
      add_string(env, endpoint, "fileType", "SOCKET") != 0 ||
      add_string(env, endpoint, "socketPath", fixture_state.path) != 0 ||
      add_int64(env, endpoint, "socketDevice", (int64_t)identity->st_dev) != 0 ||
      add_int64(env, endpoint, "socketInode", (int64_t)identity->st_ino) != 0 ||
      add_int64(env, endpoint, "socketOwnerUid", (int64_t)identity->st_uid) != 0 ||
      add_int64(env, endpoint, "socketOwnerGid", (int64_t)identity->st_gid) != 0 ||
      add_int64(env, endpoint, "socketMode", (int64_t)(identity->st_mode & 0777)) != 0 ||
      napi_set_named_property(env, object, name, endpoint) != napi_ok)
    return -1;
  return 0;
}

static int add_credentials(napi_env env, napi_value object, const char *name,
                           const struct ucred *credentials) {
  napi_value peer;
  if (napi_create_object(env, &peer) != napi_ok ||
      add_int64(env, peer, "schemaVersion", 1) != 0 ||
      add_string(env, peer, "platform", "LINUX") != 0 ||
      add_string(env, peer, "authority", "LINUX_SO_PEERCRED") != 0 ||
      add_int64(env, peer, "peerPid", (int64_t)credentials->pid) != 0 ||
      add_int64(env, peer, "peerUid", (int64_t)credentials->uid) != 0 ||
      add_int64(env, peer, "peerGid", (int64_t)credentials->gid) != 0 ||
      napi_set_named_property(env, object, name, peer) != napi_ok)
    return -1;
  return 0;
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

static int read_exact(int descriptor, uint8_t *data, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t received = read(descriptor, data + offset, length - offset);
    if (received < 0 && errno == EINTR)
      continue;
    if (received <= 0)
      return -1;
    offset += (size_t)received;
  }
  return 0;
}

static napi_value prepare_fixture(napi_env env, napi_callback_info info) {
  napi_value values[1];
  char path[sizeof(fixture_state.path)];
  struct stat existing;
  if (fixture_state.active || exact_argc(env, info, 1, values) != 0 ||
      exact_string(env, values[0], path, sizeof(path)) != 0 || lstat(path, &existing) == 0 ||
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
  if (lstat(path, &fixture_state.identity) != 0 || !S_ISSOCK(fixture_state.identity.st_mode) ||
      chmod(path, 0600) != 0) {
    close_state();
    return deny(env);
  }
  struct stat secured;
  if (lstat(path, &secured) != 0 || !same_node(&fixture_state.identity, &secured) ||
      (secured.st_mode & 0777) != 0600) {
    close_state();
    return deny(env);
  }
  fixture_state.identity = secured;
  if (listen(listener, 1) != 0) {
    close_state();
    return deny(env);
  }

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok ||
      add_endpoint(env, result, "endpointIdentity", &fixture_state.identity) != 0) {
    close_state();
    return deny(env);
  }
  return result;
}

static napi_value exchange_fixture(napi_env env, napi_callback_info info) {
  napi_value values[2];
  uint8_t *request = NULL;
  uint8_t *response = NULL;
  size_t request_length = 0;
  size_t response_length = 0;
  int client = -1;
  int accepted = -1;
  uint8_t request_copy[MAX_FRAME_BYTES];
  uint8_t response_copy[MAX_FRAME_BYTES];
  struct stat before;
  struct stat after;
  struct ucred supervisor_credentials;
  struct ucred worker_credentials;
  socklen_t credential_length = sizeof(struct ucred);
  if (!fixture_state.active || exact_argc(env, info, 2, values) != 0 ||
      exact_buffer(env, values[0], &request, &request_length) != 0 ||
      exact_buffer(env, values[1], &response, &response_length) != 0 ||
      lstat(fixture_state.path, &before) != 0 || !same_identity(&fixture_state.identity, &before)) {
    close_state();
    return deny(env);
  }

  client = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  memcpy(address.sun_path, fixture_state.path, strlen(fixture_state.path) + 1);
  if (client < 0 || connect(client, (struct sockaddr *)&address, sizeof(address)) != 0 ||
      (accepted = accept4(fixture_state.listener, NULL, NULL, SOCK_CLOEXEC)) < 0 ||
      getsockopt(client, SOL_SOCKET, SO_PEERCRED, &supervisor_credentials, &credential_length) != 0 ||
      credential_length != sizeof(struct ucred))
    goto denied;
  credential_length = sizeof(struct ucred);
  if (getsockopt(accepted, SOL_SOCKET, SO_PEERCRED, &worker_credentials, &credential_length) != 0 ||
      credential_length != sizeof(struct ucred) ||
      supervisor_credentials.pid != getpid() || worker_credentials.pid != getpid() ||
      supervisor_credentials.uid != geteuid() || worker_credentials.uid != geteuid() ||
      supervisor_credentials.gid != getegid() || worker_credentials.gid != getegid() ||
      write_all(client, request, request_length) != 0 ||
      read_exact(accepted, request_copy, request_length) != 0 ||
      memcmp(request, request_copy, request_length) != 0 ||
      write_all(accepted, response, response_length) != 0 ||
      read_exact(client, response_copy, response_length) != 0 ||
      memcmp(response, response_copy, response_length) != 0 || lstat(fixture_state.path, &after) != 0 ||
      !same_identity(&before, &after))
    goto denied;

  napi_value result;
  napi_value received_request;
  napi_value received_response;
  if (napi_create_object(env, &result) != napi_ok ||
      add_endpoint(env, result, "endpointBefore", &before) != 0 ||
      add_endpoint(env, result, "endpointAfter", &after) != 0 ||
      add_credentials(env, result, "supervisorCredentials", &supervisor_credentials) != 0 ||
      add_credentials(env, result, "workerCredentials", &worker_credentials) != 0 ||
      napi_create_buffer_copy(env, request_length, request_copy, NULL, &received_request) != napi_ok ||
      napi_create_buffer_copy(env, response_length, response_copy, NULL, &received_response) !=
          napi_ok ||
      napi_set_named_property(env, result, "receivedRequest", received_request) != napi_ok ||
      napi_set_named_property(env, result, "responseFrame", received_response) != napi_ok)
    goto denied;

  memset(request_copy, 0, sizeof(request_copy));
  memset(response_copy, 0, sizeof(response_copy));
  (void)close(client);
  (void)close(accepted);
  close_state();
  return result;

denied:
  memset(request_copy, 0, sizeof(request_copy));
  memset(response_copy, 0, sizeof(response_copy));
  if (client >= 0)
    (void)close(client);
  if (accepted >= 0)
    (void)close(accepted);
  close_state();
  return deny(env);
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value prepare_function;
  napi_value exchange_function;
  if (napi_add_env_cleanup_hook(env, environment_cleanup, NULL) != napi_ok ||
      napi_create_function(env, "prepare", NAPI_AUTO_LENGTH, prepare_fixture, NULL,
                           &prepare_function) != napi_ok ||
      napi_create_function(env, "exchange", NAPI_AUTO_LENGTH, exchange_fixture, NULL,
                           &exchange_function) != napi_ok ||
      napi_set_named_property(env, exports, "prepare", prepare_function) != napi_ok ||
      napi_set_named_property(env, exports, "exchange", exchange_function) != napi_ok)
    return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
