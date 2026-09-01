#define _GNU_SOURCE
#define NAPI_VERSION 8
#define VENTUREOS_NATIVE_ADDON 1

#include <node_api.h>

#include "native-supervisor-helper.c"

#define LIFECYCLE_SECRET_BYTES 32U
#define LIFECYCLE_DISPATCH_BYTES 2048U
#define LIFECYCLE_TRANSCRIPT_BYTES 8192U

static napi_ref lifecycle_consumer = NULL;

static int exact_argc(napi_env env, napi_callback_info info, size_t expected,
                      napi_value *values) {
  size_t actual = 0;
  if (napi_get_cb_info(env, info, &actual, NULL, NULL, NULL) != napi_ok || actual != expected)
    return -1;
  actual = expected;
  if (napi_get_cb_info(env, info, &actual, values, NULL, NULL) != napi_ok)
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

static napi_value deny_native(napi_env env, const char *code) {
  (void)napi_throw_error(env, code, "Authenticated lifecycle fixture denied");
  return NULL;
}

static napi_value launch(napi_env env, napi_callback_info info) {
  napi_value arguments[3];
  if (lifecycle_consumer == NULL || exact_argc(env, info, 3, arguments) != 0)
    return deny_native(env, "LIFECYCLE_ARGUMENTS");
  napi_value consumer;
  napi_value global;
  napi_value tuple;
  if (napi_get_reference_value(env, lifecycle_consumer, &consumer) != napi_ok ||
      napi_get_global(env, &global) != napi_ok)
    return deny_native(env, "LIFECYCLE_DENIED");
  if (napi_call_function(env, global, consumer, 1, arguments, &tuple) != napi_ok) {
    napi_value ignored_exception;
    (void)napi_get_and_clear_last_exception(env, &ignored_exception);
    return deny_native(env, "LIFECYCLE_DENIED");
  }
  bool is_array = false;
  uint32_t tuple_length = 0;
  if (napi_is_array(env, tuple, &is_array) != napi_ok || !is_array ||
      napi_get_array_length(env, tuple, &tuple_length) != napi_ok || tuple_length != 11)
    return deny_native(env, "LIFECYCLE_BINDING");
  char fixture[4096], root[4096], digest[65], uid[32], gid[32], mode[32];
  char device[32], inode[32], size[32], expires_at[32], lifecycle_mode[32];
  char *outputs[] = {fixture, root, digest, uid, gid, mode, device, inode, size, expires_at,
                     lifecycle_mode};
  const size_t capacities[] = {sizeof(fixture), sizeof(root), sizeof(digest), sizeof(uid),
                               sizeof(gid), sizeof(mode), sizeof(device), sizeof(inode),
                               sizeof(size), sizeof(expires_at), sizeof(lifecycle_mode)};
  for (uint32_t index = 0; index < 11; index += 1) {
    napi_value field;
    if (napi_get_element(env, tuple, index, &field) != napi_ok ||
        exact_string(env, field, outputs[index], capacities[index]) != 0)
      return deny_native(env, "LIFECYCLE_BINDING");
  }
  if (strcmp(lifecycle_mode, "authenticated-success") != 0 &&
      strcmp(lifecycle_mode, "authenticated-cancel") != 0)
    return deny_native(env, "LIFECYCLE_BINDING");

  bool is_typed_array = false;
  napi_typedarray_type array_type;
  size_t secret_length = 0;
  void *secret_data = NULL;
  napi_value array_buffer;
  size_t byte_offset = 0;
  if (napi_is_typedarray(env, arguments[1], &is_typed_array) != napi_ok || !is_typed_array ||
      napi_get_typedarray_info(env, arguments[1], &array_type, &secret_length, &secret_data,
                               &array_buffer, &byte_offset) != napi_ok ||
      array_type != napi_uint8_array || secret_length != LIFECYCLE_SECRET_BYTES ||
      secret_data == NULL)
    return deny_native(env, "LIFECYCLE_SECRET");
  unsigned char owned_secret[LIFECYCLE_SECRET_BYTES];
  memcpy(owned_secret, secret_data, sizeof(owned_secret));

  bool is_dispatch_array = false;
  napi_typedarray_type dispatch_array_type;
  size_t dispatch_length = 0;
  void *dispatch_data = NULL;
  napi_value dispatch_array_buffer;
  size_t dispatch_byte_offset = 0;
  if (napi_is_typedarray(env, arguments[2], &is_dispatch_array) != napi_ok ||
      !is_dispatch_array ||
      napi_get_typedarray_info(env, arguments[2], &dispatch_array_type, &dispatch_length,
                               &dispatch_data, &dispatch_array_buffer,
                               &dispatch_byte_offset) != napi_ok ||
      dispatch_array_type != napi_uint8_array || dispatch_length > LIFECYCLE_DISPATCH_BYTES ||
      (dispatch_length > 0 && dispatch_data == NULL)) {
    memset(owned_secret, 0, sizeof(owned_secret));
    return deny_native(env, "LIFECYCLE_DISPATCH");
  }
  unsigned char owned_dispatch[LIFECYCLE_DISPATCH_BYTES] = {0};
  if (dispatch_length > 0) memcpy(owned_dispatch, dispatch_data, dispatch_length);

  char *native_arguments[] = {(char *)"ventureos-authenticated-lifecycle-addon",
                              (char *)"--fixture", fixture, (char *)"--root", root,
                              (char *)"--sha256", digest, (char *)"--uid", uid,
                              (char *)"--gid", gid, (char *)"--mode", mode,
                              (char *)"--dev", device, (char *)"--ino", inode,
                              (char *)"--size", size, (char *)"--expires-at-ms", expires_at,
                              (char *)"--operation", lifecycle_mode};
  char evidence[1024] = {0};
  char transcript[LIFECYCLE_TRANSCRIPT_BYTES] = {0};
  size_t transcript_length = 0;
  int supervisor_status =
      run_supervisor(23, native_arguments, owned_secret, sizeof(owned_secret), owned_dispatch,
                     dispatch_length, evidence, transcript, sizeof(transcript),
                     &transcript_length);
  memset(owned_secret, 0, sizeof(owned_secret));
  memset(owned_dispatch, 0, sizeof(owned_dispatch));
  if (supervisor_status != 0) return deny_native(env, "LIFECYCLE_DENIED");

  napi_value result;
  napi_value evidence_value;
  napi_value transcript_value;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_string_utf8(env, evidence, NAPI_AUTO_LENGTH, &evidence_value) != napi_ok ||
      napi_create_buffer_copy(env, transcript_length, transcript, NULL, &transcript_value) !=
          napi_ok ||
      napi_set_named_property(env, result, "evidence", evidence_value) != napi_ok ||
      napi_set_named_property(env, result, "transcript", transcript_value) != napi_ok)
    return deny_native(env, "LIFECYCLE_EVIDENCE");
  memset(transcript, 0, sizeof(transcript));
  return result;
}

static napi_value bind_consumer(napi_env env, napi_callback_info info) {
  napi_value values[1];
  napi_valuetype type;
  if (lifecycle_consumer != NULL || exact_argc(env, info, 1, values) != 0 ||
      napi_typeof(env, values[0], &type) != napi_ok || type != napi_function ||
      napi_create_reference(env, values[0], 1, &lifecycle_consumer) != napi_ok)
    return deny_native(env, "LIFECYCLE_BOOTSTRAP");
  napi_value launch_function;
  if (napi_create_function(env, "launch", NAPI_AUTO_LENGTH, launch, NULL, &launch_function) !=
      napi_ok) {
    (void)napi_delete_reference(env, lifecycle_consumer);
    lifecycle_consumer = NULL;
    return deny_native(env, "LIFECYCLE_BOOTSTRAP");
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
