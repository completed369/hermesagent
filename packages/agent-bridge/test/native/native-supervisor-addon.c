#define _GNU_SOURCE
#define NAPI_VERSION 8
#define VENTUREOS_NATIVE_ADDON 1

#include <node_api.h>

#include "native-supervisor-helper.c"

static napi_ref bound_consumer = NULL;

static int exact_argc(napi_env env, napi_callback_info info, size_t expected,
                      napi_value *values) {
  size_t actual = 0;
  if (napi_get_cb_info(env, info, &actual, NULL, NULL, NULL) != napi_ok || actual != expected)
    return -1;
  actual = expected;
  if (expected > 0 && napi_get_cb_info(env, info, &actual, values, NULL, NULL) != napi_ok)
    return -1;
  return actual == expected ? 0 : -1;
}

static int exact_string(napi_env env, napi_value value, char *output, size_t capacity) {
  napi_valuetype type;
  size_t required = 0;
  size_t copied = 0;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
      napi_get_value_string_utf8(env, value, NULL, 0, &required) != napi_ok || required == 0 ||
      required >= capacity ||
      napi_get_value_string_utf8(env, value, output, capacity, &copied) != napi_ok ||
      copied != required || memchr(output, '\0', copied) != NULL)
    return -1;
  return 0;
}

static napi_value launch(napi_env env, napi_callback_info info) {
  napi_value handoff[1];
  if (bound_consumer == NULL || exact_argc(env, info, 1, handoff) != 0) {
    (void)napi_throw_error(env, "NATIVE_ARGUMENTS", "Native fixture invocation denied");
    return NULL;
  }
  napi_value consumer;
  napi_value global;
  napi_value tuple;
  if (napi_get_reference_value(env, bound_consumer, &consumer) != napi_ok ||
      napi_get_global(env, &global) != napi_ok) {
    (void)napi_throw_error(env, "NATIVE_DENIED", "Native fixture invocation denied");
    return NULL;
  }
  if (napi_call_function(env, global, consumer, 1, handoff, &tuple) != napi_ok) {
    napi_value ignored_exception;
    (void)napi_get_and_clear_last_exception(env, &ignored_exception);
    (void)napi_throw_error(env, "NATIVE_DENIED", "Native fixture invocation denied");
    return NULL;
  }
  bool is_array = false;
  uint32_t tuple_length = 0;
  if (napi_is_array(env, tuple, &is_array) != napi_ok || !is_array ||
      napi_get_array_length(env, tuple, &tuple_length) != napi_ok || tuple_length != 10) {
    (void)napi_throw_error(env, "NATIVE_BINDING", "Native fixture invocation denied");
    return NULL;
  }
  char fixture[4096];
  char root[4096];
  char digest[65];
  char uid[32];
  char gid[32];
  char mode[32];
  char device[32];
  char inode[32];
  char size[32];
  char expires_at[32];
  char *outputs[] = {fixture, root, digest, uid, gid, mode,
                     device,  inode, size,   expires_at};
  const size_t capacities[] = {sizeof(fixture), sizeof(root), sizeof(digest), sizeof(uid),
                               sizeof(gid),     sizeof(mode), sizeof(device), sizeof(inode),
                               sizeof(size),    sizeof(expires_at)};
  for (uint32_t index = 0; index < 10; index += 1) {
    napi_value field;
    if (napi_get_element(env, tuple, index, &field) != napi_ok ||
        exact_string(env, field, outputs[index], capacities[index]) != 0) {
      (void)napi_throw_error(env, "NATIVE_BINDING", "Native fixture invocation denied");
      return NULL;
    }
  }
  char *arguments[] = {(char *)"ventureos-native-supervisor-addon",
                       (char *)"--fixture",
                       fixture,
                       (char *)"--root",
                       root,
                       (char *)"--sha256",
                       digest,
                       (char *)"--uid",
                       uid,
                       (char *)"--gid",
                       gid,
                       (char *)"--mode",
                       mode,
                       (char *)"--dev",
                       device,
                       (char *)"--ino",
                       inode,
                       (char *)"--size",
                       size,
                       (char *)"--expires-at-ms",
                       expires_at,
                       (char *)"--operation",
                       (char *)"normal"};
  char evidence[1024] = {0};
  if (run_supervisor(23, arguments, NULL, 0, NULL, 0, evidence, NULL, 0, NULL) != 0) {
    (void)napi_throw_error(env, "NATIVE_DENIED", "Native fixture invocation denied");
    return NULL;
  }
  napi_value result;
  if (napi_create_string_utf8(env, evidence, NAPI_AUTO_LENGTH, &result) != napi_ok) {
    (void)napi_throw_error(env, "NATIVE_EVIDENCE", "Native fixture invocation denied");
    return NULL;
  }
  return result;
}

static napi_value bind_consumer(napi_env env, napi_callback_info info) {
  napi_value values[1];
  napi_valuetype type;
  if (bound_consumer != NULL || exact_argc(env, info, 1, values) != 0 ||
      napi_typeof(env, values[0], &type) != napi_ok || type != napi_function ||
      napi_create_reference(env, values[0], 1, &bound_consumer) != napi_ok) {
    (void)napi_throw_error(env, "NATIVE_BOOTSTRAP", "Native fixture invocation denied");
    return NULL;
  }
  napi_value launch_function;
  if (napi_create_function(env, "launch", NAPI_AUTO_LENGTH, launch, NULL, &launch_function) !=
      napi_ok) {
    (void)napi_delete_reference(env, bound_consumer);
    bound_consumer = NULL;
    (void)napi_throw_error(env, "NATIVE_BOOTSTRAP", "Native fixture invocation denied");
    return NULL;
  }
  return launch_function;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value bind_function;
  if (napi_create_function(env, "bind", NAPI_AUTO_LENGTH, bind_consumer, NULL, &bind_function) !=
          napi_ok ||
      napi_set_named_property(env, exports, "bind", bind_function) != napi_ok)
    return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
