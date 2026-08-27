#define _GNU_SOURCE

#if !defined(__linux__) || !defined(__x86_64__)
#error "The native runtime fixture requires Linux x86_64"
#endif

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

#define SECRET_FD 3
#define SECRET_BYTES 32U
#define SHA256_BYTES 32U
#define MAX_FRAME_BYTES 2048U

typedef struct {
  uint32_t state[8];
  uint64_t bit_length;
  unsigned char block[64];
  size_t block_length;
} sha256_context;

static const uint32_t sha256_constants[64] = {
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U,
    0x923f82a4U, 0xab1c5ed5U, 0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
    0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U, 0xe49b69c1U, 0xefbe4786U,
    0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U,
    0x06ca6351U, 0x14292967U, 0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
    0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U, 0xa2bfe8a1U, 0xa81a664bU,
    0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU,
    0x5b9cca4fU, 0x682e6ff3U, 0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
    0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U};

static uint32_t rotate_right(uint32_t value, unsigned int amount) {
  return (value >> amount) | (value << (32U - amount));
}

static void sha256_transform(sha256_context *context, const unsigned char block[64]) {
  uint32_t words[64];
  for (size_t index = 0; index < 16; index += 1)
    words[index] = ((uint32_t)block[index * 4] << 24) |
                   ((uint32_t)block[index * 4 + 1] << 16) |
                   ((uint32_t)block[index * 4 + 2] << 8) | block[index * 4 + 3];
  for (size_t index = 16; index < 64; index += 1) {
    uint32_t left = rotate_right(words[index - 15], 7) ^
                    rotate_right(words[index - 15], 18) ^ (words[index - 15] >> 3);
    uint32_t right = rotate_right(words[index - 2], 17) ^
                     rotate_right(words[index - 2], 19) ^ (words[index - 2] >> 10);
    words[index] = words[index - 16] + left + words[index - 7] + right;
  }
  uint32_t a = context->state[0], b = context->state[1], c = context->state[2];
  uint32_t d = context->state[3], e = context->state[4], f = context->state[5];
  uint32_t g = context->state[6], h = context->state[7];
  for (size_t index = 0; index < 64; index += 1) {
    uint32_t first = h + (rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25)) +
                     ((e & f) ^ ((~e) & g)) + sha256_constants[index] + words[index];
    uint32_t second = (rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22)) +
                      ((a & b) ^ (a & c) ^ (b & c));
    h = g; g = f; f = e; e = d + first; d = c; c = b; b = a; a = first + second;
  }
  context->state[0] += a; context->state[1] += b; context->state[2] += c;
  context->state[3] += d; context->state[4] += e; context->state[5] += f;
  context->state[6] += g; context->state[7] += h;
}

static void sha256_init(sha256_context *context) {
  const uint32_t initial[8] = {0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
                               0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U};
  memcpy(context->state, initial, sizeof(initial));
  context->bit_length = 0;
  context->block_length = 0;
}

static void sha256_update(sha256_context *context, const unsigned char *input, size_t length) {
  for (size_t index = 0; index < length; index += 1) {
    context->block[context->block_length++] = input[index];
    if (context->block_length == sizeof(context->block)) {
      sha256_transform(context, context->block);
      context->bit_length += 512U;
      context->block_length = 0;
    }
  }
}

static void sha256_final(sha256_context *context, unsigned char output[SHA256_BYTES]) {
  size_t index = context->block_length;
  context->block[index++] = 0x80U;
  if (index > 56) {
    while (index < 64) context->block[index++] = 0;
    sha256_transform(context, context->block);
    index = 0;
  }
  while (index < 56) context->block[index++] = 0;
  context->bit_length += (uint64_t)context->block_length * 8U;
  for (size_t shift = 0; shift < 8; shift += 1)
    context->block[63 - shift] = (unsigned char)(context->bit_length >> (shift * 8));
  sha256_transform(context, context->block);
  for (size_t word = 0; word < 8; word += 1)
    for (size_t byte = 0; byte < 4; byte += 1)
      output[word * 4 + byte] = (unsigned char)(context->state[word] >> (24U - byte * 8U));
}

static void sha256(const unsigned char *input, size_t length,
                   unsigned char output[SHA256_BYTES]) {
  sha256_context context;
  sha256_init(&context);
  sha256_update(&context, input, length);
  sha256_final(&context, output);
}

static void hmac_sha256(const unsigned char *key, size_t key_length,
                        const unsigned char *input, size_t input_length,
                        unsigned char output[SHA256_BYTES]) {
  unsigned char normalized[64] = {0};
  unsigned char inner_digest[SHA256_BYTES];
  if (key_length > sizeof(normalized)) sha256(key, key_length, normalized);
  else memcpy(normalized, key, key_length);
  unsigned char inner_pad[64], outer_pad[64];
  for (size_t index = 0; index < 64; index += 1) {
    inner_pad[index] = normalized[index] ^ 0x36U;
    outer_pad[index] = normalized[index] ^ 0x5cU;
  }
  sha256_context context;
  sha256_init(&context); sha256_update(&context, inner_pad, 64);
  sha256_update(&context, input, input_length); sha256_final(&context, inner_digest);
  sha256_init(&context); sha256_update(&context, outer_pad, 64);
  sha256_update(&context, inner_digest, SHA256_BYTES); sha256_final(&context, output);
  memset(normalized, 0, sizeof(normalized)); memset(inner_digest, 0, sizeof(inner_digest));
  memset(inner_pad, 0, sizeof(inner_pad)); memset(outer_pad, 0, sizeof(outer_pad));
}

static void derive_runtime_key(const unsigned char secret[SECRET_BYTES],
                               unsigned char output[SHA256_BYTES]) {
  static const char context_json[] =
      "{\"connectionId\":\"lifecycle-connection\",\"parentNonce\":\"lifecycle-parent-nonce\","
      "\"principalReference\":\"lifecycle-principal\",\"runtimeId\":\"lifecycle-runtime\","
      "\"runtimeNonce\":\"lifecycle-runtime-nonce\",\"sessionId\":\"lifecycle-session\","
      "\"workspaceId\":\"lifecycle-workspace\"}";
  static const char info[] = "ventureos.bridge.v1:runtime-to-parent";
  unsigned char salt[SHA256_BYTES], pseudorandom_key[SHA256_BYTES];
  unsigned char expand_input[sizeof(info)];
  sha256((const unsigned char *)context_json, strlen(context_json), salt);
  hmac_sha256(salt, SHA256_BYTES, secret, SECRET_BYTES, pseudorandom_key);
  memcpy(expand_input, info, sizeof(info) - 1); expand_input[sizeof(info) - 1] = 1;
  hmac_sha256(pseudorandom_key, SHA256_BYTES, expand_input, sizeof(expand_input), output);
  memset(salt, 0, sizeof(salt)); memset(pseudorandom_key, 0, sizeof(pseudorandom_key));
  memset(expand_input, 0, sizeof(expand_input));
}

static void hex_digest(const unsigned char digest[SHA256_BYTES], char output[65]) {
  static const char digits[] = "0123456789abcdef";
  for (size_t index = 0; index < SHA256_BYTES; index += 1) {
    output[index * 2] = digits[digest[index] >> 4];
    output[index * 2 + 1] = digits[digest[index] & 0x0fU];
  }
  output[64] = '\0';
}

static void base64url(const unsigned char input[SHA256_BYTES], char output[44]) {
  static const char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  size_t cursor = 0;
  for (size_t index = 0; index < 30; index += 3) {
    uint32_t value = ((uint32_t)input[index] << 16) |
                     ((uint32_t)input[index + 1] << 8) | input[index + 2];
    output[cursor++] = alphabet[(value >> 18) & 63U];
    output[cursor++] = alphabet[(value >> 12) & 63U];
    output[cursor++] = alphabet[(value >> 6) & 63U];
    output[cursor++] = alphabet[value & 63U];
  }
  uint32_t tail = ((uint32_t)input[30] << 16) | ((uint32_t)input[31] << 8);
  output[cursor++] = alphabet[(tail >> 18) & 63U];
  output[cursor++] = alphabet[(tail >> 12) & 63U];
  output[cursor++] = alphabet[(tail >> 6) & 63U];
  output[cursor] = '\0';
}

static int exact_write(int descriptor, const char *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t written = write(descriptor, buffer + offset, length - offset);
    if (written > 0) { offset += (size_t)written; continue; }
    if (written < 0 && errno == EINTR) continue;
    return -1;
  }
  return 0;
}

static int read_secret(unsigned char secret[SECRET_BYTES]) {
  size_t offset = 0;
  while (offset < SECRET_BYTES) {
    ssize_t count = read(SECRET_FD, secret + offset, SECRET_BYTES - offset);
    if (count > 0) { offset += (size_t)count; continue; }
    if (count < 0 && errno == EINTR) continue;
    return -1;
  }
  unsigned char extra = 0;
  ssize_t trailing = read(SECRET_FD, &extra, 1);
  (void)close(SECRET_FD);
  return trailing == 0 ? 0 : -1;
}

static int utc_timestamp(time_t value, char output[25]) {
  struct tm utc;
  if (gmtime_r(&value, &utc) == NULL) return -1;
  return strftime(output, 25, "%Y-%m-%dT%H:%M:%S.000Z", &utc) == 24 ? 0 : -1;
}

static int build_frame(unsigned int sequence, const char *type, const char *payload,
                       const char *issued_at, const char *expires_at,
                       const unsigned char key[SHA256_BYTES], char output[MAX_FRAME_BYTES],
                       size_t *output_length) {
  unsigned char payload_bytes[SHA256_BYTES], mac_bytes[SHA256_BYTES];
  char payload_digest[65], mac[44], unsigned_json[MAX_FRAME_BYTES];
  sha256((const unsigned char *)payload, strlen(payload), payload_bytes);
  hex_digest(payload_bytes, payload_digest);
  int unsigned_length = snprintf(
      unsigned_json, sizeof(unsigned_json),
      "{\"connectionId\":\"lifecycle-connection\",\"expiresAt\":\"%s\","
      "\"issuedAt\":\"%s\",\"messageId\":\"lifecycle-message-%u\",\"payload\":%s,"
      "\"payloadDigest\":\"%s\",\"principalReference\":\"lifecycle-principal\","
      "\"protocolVersion\":\"ventureos.bridge.v1\",\"runtimeId\":\"lifecycle-runtime\","
      "\"sequence\":%u,\"sessionId\":\"lifecycle-session\",\"type\":\"%s\","
      "\"workspaceId\":\"lifecycle-workspace\"}", expires_at, issued_at, sequence,
      payload, payload_digest, sequence, type);
  if (unsigned_length <= 0 || (size_t)unsigned_length >= sizeof(unsigned_json)) return -1;
  hmac_sha256(key, SHA256_BYTES, (const unsigned char *)unsigned_json,
              (size_t)unsigned_length, mac_bytes);
  base64url(mac_bytes, mac);
  int length = snprintf(
      output, MAX_FRAME_BYTES,
      "{\"connectionId\":\"lifecycle-connection\",\"expiresAt\":\"%s\","
      "\"issuedAt\":\"%s\",\"mac\":\"%s\",\"messageId\":\"lifecycle-message-%u\","
      "\"payload\":%s,\"payloadDigest\":\"%s\","
      "\"principalReference\":\"lifecycle-principal\","
      "\"protocolVersion\":\"ventureos.bridge.v1\",\"runtimeId\":\"lifecycle-runtime\","
      "\"sequence\":%u,\"sessionId\":\"lifecycle-session\",\"type\":\"%s\","
      "\"workspaceId\":\"lifecycle-workspace\"}\n", expires_at, issued_at, mac, sequence,
      payload, payload_digest, sequence, type);
  memset(payload_bytes, 0, sizeof(payload_bytes)); memset(mac_bytes, 0, sizeof(mac_bytes));
  memset(unsigned_json, 0, sizeof(unsigned_json));
  if (length <= 0 || (size_t)length >= MAX_FRAME_BYTES) return -1;
  *output_length = (size_t)length;
  return 0;
}

static char cancellation_frame[MAX_FRAME_BYTES];
static size_t cancellation_frame_length = 0;
static void cancel_and_exit(int signal_number) {
  (void)signal_number;
  if (cancellation_frame_length > 0)
    (void)exact_write(STDOUT_FILENO, cancellation_frame, cancellation_frame_length);
  _exit(0);
}

static int limits_are_exact(void) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_CORE, &limit) != 0 || limit.rlim_cur != 0 || limit.rlim_max != 0) return 0;
  if (getrlimit(RLIMIT_CPU, &limit) != 0 || limit.rlim_cur != 2 || limit.rlim_max != 2) return 0;
  if (getrlimit(RLIMIT_AS, &limit) != 0 || limit.rlim_cur != 64U * 1024U * 1024U ||
      limit.rlim_max != 64U * 1024U * 1024U) return 0;
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0 || limit.rlim_cur != 32 || limit.rlim_max != 32) return 0;
  if (getrlimit(RLIMIT_NPROC, &limit) != 0 || limit.rlim_cur != 8 || limit.rlim_max != 8) return 0;
  return 1;
}

static int verify_runtime_boundary(void) {
  if (environ == NULL || environ[0] != NULL) return 21;
  if (prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1) return 22;
  if (!limits_are_exact()) return 23;
  char executable_path[256] = {0};
  ssize_t path_length = readlink("/proc/self/exe", executable_path, sizeof(executable_path) - 1);
  if (path_length <= 0 || strstr(executable_path, "memfd:ventureos-runtime-fixture") == NULL) return 24;
  int marker = open("fixture.marker", O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  char marker_value[8] = {0};
  if (marker < 0 || read(marker, marker_value, 7) != 7 || memcmp(marker_value, "trusted", 7) != 0)
    return 25;
  (void)close(marker);
  errno = 0;
  int forbidden_socket = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (forbidden_socket >= 0 || errno != EPERM) {
    if (forbidden_socket >= 0) (void)close(forbidden_socket);
    return 26;
  }
  errno = 0;
  if (fork() >= 0 || errno != EPERM) return 28;
  errno = 0;
  if (syscall(SYS_setsid) >= 0 || errno != EPERM) return 29;
  errno = 0;
  if (syscall(SYS_setpgid, 0, 0) >= 0 || errno != EPERM) return 30;
  return 0;
}

static int authenticated_lifecycle(const char *mode) {
  unsigned char secret[SECRET_BYTES], runtime_key[SHA256_BYTES];
  if (read_secret(secret) != 0) return 40;
  derive_runtime_key(secret, runtime_key);
  memset(secret, 0, sizeof(secret));
  struct timespec observed;
  char issued_at[25], expires_at[25];
  if (clock_gettime(CLOCK_REALTIME, &observed) != 0 ||
      utc_timestamp(observed.tv_sec, issued_at) != 0 ||
      utc_timestamp(observed.tv_sec + 60, expires_at) != 0) {
    memset(runtime_key, 0, sizeof(runtime_key)); return 41;
  }
  char first[MAX_FRAME_BYTES], second[MAX_FRAME_BYTES], third[MAX_FRAME_BYTES];
  size_t first_length = 0, second_length = 0, third_length = 0;
  const int cancelled = strcmp(mode, "authenticated-cancel") == 0;
  if (build_frame(1, "CAPABILITIES", "{\"protocol\":\"jsonl-v1\"}", issued_at,
                  expires_at, runtime_key, first, &first_length) != 0 ||
      build_frame(2, "HEARTBEAT", "{\"health\":\"HEALTHY\"}", issued_at, expires_at,
                  runtime_key, second, &second_length) != 0 ||
      build_frame(3, cancelled ? "CANCELLED" : "RESULT",
                  cancelled ? "{\"reason\":\"PARENT_CANCELLED\"}"
                            : "{\"outcome\":\"SUCCEEDED\"}",
                  issued_at, expires_at, runtime_key, third, &third_length) != 0) {
    memset(runtime_key, 0, sizeof(runtime_key)); return 42;
  }
  memset(runtime_key, 0, sizeof(runtime_key));
  if (cancelled) {
    memcpy(cancellation_frame, third, third_length); cancellation_frame_length = third_length;
    if (signal(SIGTERM, cancel_and_exit) == SIG_ERR) return 45;
  }
  if (exact_write(STDOUT_FILENO, first, first_length) != 0 ||
      exact_write(STDOUT_FILENO, second, second_length) != 0) return 43;
  if (!cancelled) return exact_write(STDOUT_FILENO, third, third_length) == 0 ? 0 : 44;
  for (;;) pause();
}

int main(int argc, char **argv) {
  if (argc != 3 || strcmp(argv[0], "ventureos-native-runtime-fixture") != 0 ||
      strcmp(argv[1], "--mode") != 0) return 20;
  int boundary = verify_runtime_boundary();
  if (boundary != 0) return boundary;
  if (strcmp(argv[2], "authenticated-success") == 0 ||
      strcmp(argv[2], "authenticated-cancel") == 0)
    return authenticated_lifecycle(argv[2]);
  if (strcmp(argv[2], "jsonl-fixture") != 0) return 20;
  if (signal(SIGTERM, SIG_IGN) == SIG_ERR) return 27;
  if (write(STDOUT_FILENO, "READY\n", 6) != 6) return 31;
  for (;;) pause();
}
