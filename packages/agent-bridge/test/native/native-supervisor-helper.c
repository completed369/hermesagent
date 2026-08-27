#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#if !defined(__linux__) || !defined(__x86_64__)
#error "The native supervisor evidence helper requires Linux x86_64"
#endif

#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/if_alg.h>
#include <linux/memfd.h>
#include <linux/openat2.h>
#include <linux/seccomp.h>
#include <poll.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef SYS_execveat
#error "execveat syscall number is required"
#endif
#ifndef SYS_memfd_create
#error "memfd_create syscall number is required"
#endif
#ifndef SYS_openat2
#error "openat2 syscall number is required"
#endif
#ifndef SYS_pidfd_open
#error "pidfd_open syscall number is required"
#endif

#define MAX_EXECUTABLE_BYTES (1024U * 1024U)
#define SHA256_BYTES 32U
#define SHA256_HEX_BYTES 64U
#define EXEC_TIMEOUT_MS 3000
#define READY_TIMEOUT_MS 3000
#define TERM_GRACE_MS 200
#define KILL_TIMEOUT_MS 3000

static int deny(const char *code) {
  (void)fprintf(stderr, "NATIVE_SUPERVISOR_DENIED:%s\n", code);
  return 70;
}

static int exact_mode(const char *mode) {
  return strcmp(mode, "normal") == 0 || strcmp(mode, "tamper-after-copy") == 0 ||
         strcmp(mode, "replace-after-copy") == 0;
}

static int parse_unsigned(const char *text, unsigned long maximum, unsigned long *output) {
  char *end = NULL;
  errno = 0;
  unsigned long value = strtoul(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || value > maximum) return -1;
  *output = value;
  return 0;
}

static int permit_is_current(unsigned long expires_at_ms) {
  struct timespec launch_clock;
  if (clock_gettime(CLOCK_REALTIME, &launch_clock) != 0 || launch_clock.tv_sec < 0 ||
      (unsigned long)launch_clock.tv_sec > (~0UL / 1000UL))
    return 0;
  unsigned long observed_ms =
      (unsigned long)launch_clock.tv_sec * 1000UL +
      (unsigned long)launch_clock.tv_nsec / 1000000UL;
  return observed_ms < expires_at_ms;
}

static int hex_nibble(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  return -1;
}

static int decode_hex(const char *hex, unsigned char output[SHA256_BYTES]) {
  if (strlen(hex) != SHA256_HEX_BYTES) return -1;
  for (size_t index = 0; index < SHA256_BYTES; index += 1) {
    int high = hex_nibble(hex[index * 2]);
    int low = hex_nibble(hex[index * 2 + 1]);
    if (high < 0 || low < 0) return -1;
    output[index] = (unsigned char)((high << 4) | low);
  }
  return 0;
}

static void encode_hex(const unsigned char input[SHA256_BYTES], char output[65]) {
  static const char digits[] = "0123456789abcdef";
  for (size_t index = 0; index < SHA256_BYTES; index += 1) {
    output[index * 2] = digits[input[index] >> 4];
    output[index * 2 + 1] = digits[input[index] & 0x0fU];
  }
  output[64] = '\0';
}

static int hash_buffer(const unsigned char *buffer, size_t length,
                       unsigned char digest[SHA256_BYTES]) {
  int algorithm = -1;
  int operation = -1;
  int result = -1;
  struct sockaddr_alg address;
  memset(&address, 0, sizeof(address));
  address.salg_family = AF_ALG;
  memcpy(address.salg_type, "hash", 5);
  memcpy(address.salg_name, "sha256", 7);

  algorithm = socket(AF_ALG, SOCK_SEQPACKET | SOCK_CLOEXEC, 0);
  if (algorithm < 0) goto cleanup;
  if (bind(algorithm, (struct sockaddr *)&address, sizeof(address)) != 0) goto cleanup;
  operation = accept4(algorithm, NULL, NULL, SOCK_CLOEXEC);
  if (operation < 0) goto cleanup;
  size_t sent = 0;
  while (sent < length) {
    size_t remaining = length - sent;
    size_t chunk = remaining > 65536U ? 65536U : remaining;
    int flags = remaining > chunk ? MSG_MORE : 0;
    ssize_t count = send(operation, buffer + sent, chunk, flags);
    if (count <= 0) goto cleanup;
    sent += (size_t)count;
  }
  if (read(operation, digest, SHA256_BYTES) != (ssize_t)SHA256_BYTES) goto cleanup;
  result = 0;

cleanup:
  if (operation >= 0) (void)close(operation);
  if (algorithm >= 0) (void)close(algorithm);
  return result;
}

static int metadata_equal(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
         left->st_mode == right->st_mode && left->st_uid == right->st_uid &&
         left->st_gid == right->st_gid && left->st_size == right->st_size &&
         left->st_mtim.tv_sec == right->st_mtim.tv_sec &&
         left->st_mtim.tv_nsec == right->st_mtim.tv_nsec &&
         left->st_ctim.tv_sec == right->st_ctim.tv_sec &&
         left->st_ctim.tv_nsec == right->st_ctim.tv_nsec;
}

static int write_all(int descriptor, const unsigned char *buffer, size_t length) {
  size_t written = 0;
  while (written < length) {
    ssize_t count = write(descriptor, buffer + written, length - written);
    if (count <= 0) return -1;
    written += (size_t)count;
  }
  return 0;
}

static int install_fixture_seccomp(void) {
  struct sock_filter filter[] = {
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
      BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_socket, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_fork, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_vfork, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
#ifdef __NR_clone3
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
#endif
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_setsid, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
      BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_setpgid, 0, 1),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
      BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog program = {
      .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
      .filter = filter,
  };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) return -1;
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) return -1;
  return 0;
}

static int apply_limits(void) {
  const struct {
    int resource;
    rlim_t current;
    rlim_t maximum;
  } limits[] = {
      {RLIMIT_CORE, 0, 0},
      {RLIMIT_CPU, 2, 2},
      {RLIMIT_AS, 64U * 1024U * 1024U, 64U * 1024U * 1024U},
      {RLIMIT_NOFILE, 32, 32},
      {RLIMIT_NPROC, 8, 8},
  };
  for (size_t index = 0; index < sizeof(limits) / sizeof(limits[0]); index += 1) {
    const struct rlimit limit = {
        .rlim_cur = limits[index].current,
        .rlim_max = limits[index].maximum,
    };
    if (setrlimit(limits[index].resource, &limit) != 0) return -1;
  }
  return 0;
}

static void child_exec(int executable, int working_directory, int status_write, int ready_write) {
  if (setpgid(0, 0) != 0) goto failed;
  if (dup2(ready_write, STDOUT_FILENO) < 0) goto failed;
  if (ready_write != STDOUT_FILENO) (void)close(ready_write);
  if (fchdir(working_directory) != 0) goto failed;
  if (apply_limits() != 0) goto failed;
  if (install_fixture_seccomp() != 0) goto failed;

  char *const arguments[] = {(char *)"ventureos-native-runtime-fixture", (char *)"--mode",
                             (char *)"jsonl-fixture", NULL};
  char *const environment[] = {NULL};
  (void)syscall(SYS_execveat, executable, "", arguments, environment, AT_EMPTY_PATH);

failed: {
    const int child_errno = errno;
    (void)write(status_write, &child_errno, sizeof(child_errno));
    _exit(127);
  }
}

static void reap_process_group(pid_t process_group) {
  int status = 0;
  for (;;) {
    pid_t reaped = waitpid(-process_group, &status, WNOHANG);
    if (reaped > 0) continue;
    if (reaped < 0 && errno == EINTR) continue;
    break;
  }
}

static int wait_child_bounded(pid_t child, int *status) {
  for (int attempt = 0; attempt < KILL_TIMEOUT_MS / 10; attempt += 1) {
    pid_t waited = waitpid(child, status, WNOHANG);
    if (waited == child) return 0;
    if (waited < 0 && errno != EINTR) return -1;
    const struct timespec delay = {.tv_sec = 0, .tv_nsec = 10000000};
    (void)nanosleep(&delay, NULL);
  }
  return -1;
}

static void force_cleanup(pid_t child, int pidfd) {
  if (child <= 0) return;
  (void)kill(-child, SIGKILL);
  if (pidfd >= 0) {
    struct pollfd monitor = {.fd = pidfd, .events = POLLIN};
    (void)poll(&monitor, 1, KILL_TIMEOUT_MS);
  }
  int status = 0;
  (void)wait_child_bounded(child, &status);
  reap_process_group(child);
}

static int run_supervisor(int argc, char **argv, char evidence_output[1024]) {
  if (argc != 23 || strcmp(argv[1], "--fixture") != 0 || strcmp(argv[3], "--root") != 0 ||
      strcmp(argv[5], "--sha256") != 0 || strcmp(argv[7], "--uid") != 0 ||
      strcmp(argv[9], "--gid") != 0 || strcmp(argv[11], "--mode") != 0 ||
      strcmp(argv[13], "--dev") != 0 || strcmp(argv[15], "--ino") != 0 ||
      strcmp(argv[17], "--size") != 0 || strcmp(argv[19], "--expires-at-ms") != 0 ||
      strcmp(argv[21], "--operation") != 0 || !exact_mode(argv[22]))
    return deny("ARGUMENTS");
  const char *fixture_path = argv[2];
  const char *root_path = argv[4];
  const char *expected_hex = argv[6];
  const char *mode = argv[22];
  unsigned long expected_uid = 0;
  unsigned long expected_gid = 0;
  unsigned long expected_mode = 0;
  unsigned long expected_device = 0;
  unsigned long expected_inode = 0;
  unsigned long expected_size = 0;
  unsigned long expires_at_ms = 0;
  if (parse_unsigned(argv[8], 2147483647UL, &expected_uid) != 0 ||
      parse_unsigned(argv[10], 2147483647UL, &expected_gid) != 0 ||
      parse_unsigned(argv[12], 07777UL, &expected_mode) != 0 ||
      parse_unsigned(argv[14], ~0UL, &expected_device) != 0 ||
      parse_unsigned(argv[16], ~0UL, &expected_inode) != 0 ||
      parse_unsigned(argv[18], MAX_EXECUTABLE_BYTES, &expected_size) != 0 ||
      parse_unsigned(argv[20], ~0UL, &expires_at_ms) != 0)
    return deny("METADATA_INPUT");
  if (!permit_is_current(expires_at_ms)) return deny("PERMIT_EXPIRED");
  unsigned char expected_digest[SHA256_BYTES];
  if (decode_hex(expected_hex, expected_digest) != 0)
    return deny("DIGEST_INPUT");

  int source = open(fixture_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  if (source < 0) return deny("SOURCE_OPEN");
  struct stat initial;
  if (fstat(source, &initial) != 0 || !S_ISREG(initial.st_mode) ||
      initial.st_dev != (dev_t)expected_device || initial.st_ino != (ino_t)expected_inode ||
      initial.st_uid != (uid_t)expected_uid || initial.st_gid != (gid_t)expected_gid ||
      (initial.st_mode & 07777) != (mode_t)expected_mode || (initial.st_mode & 0111) == 0 ||
      (initial.st_mode & (S_ISUID | S_ISGID | S_ISVTX | S_IWUSR | S_IWGRP | S_IWOTH)) != 0 ||
      initial.st_size != (off_t)expected_size || initial.st_size < 4 ||
      initial.st_size > (off_t)MAX_EXECUTABLE_BYTES) {
    (void)close(source);
    return deny("SOURCE_METADATA");
  }

  const size_t executable_size = (size_t)initial.st_size;
  unsigned char *bytes = malloc(executable_size);
  if (bytes == NULL) {
    (void)close(source);
    return deny("MEMORY");
  }
  size_t offset = 0;
  while (offset < executable_size) {
    ssize_t count = pread(source, bytes + offset, executable_size - offset, (off_t)offset);
    if (count <= 0) {
      free(bytes);
      (void)close(source);
      return deny("SOURCE_READ");
    }
    offset += (size_t)count;
  }
  if (bytes[0] != 0x7f || bytes[1] != 'E' || bytes[2] != 'L' || bytes[3] != 'F') {
    free(bytes);
    (void)close(source);
    return deny("ELF_REQUIRED");
  }

  unsigned char source_digest[SHA256_BYTES];
  if (hash_buffer(bytes, executable_size, source_digest) != 0 ||
      memcmp(source_digest, expected_digest, SHA256_BYTES) != 0) {
    free(bytes);
    (void)close(source);
    return deny("DIGEST_MISMATCH");
  }

  int executable = (int)syscall(SYS_memfd_create, "ventureos-runtime-fixture",
                                MFD_CLOEXEC | MFD_ALLOW_SEALING);
  if (executable < 0 || write_all(executable, bytes, executable_size) != 0 ||
      fchmod(executable, 0500) != 0 || lseek(executable, 0, SEEK_SET) < 0) {
    free(bytes);
    (void)close(source);
    if (executable >= 0) (void)close(executable);
    return deny("MEMFD_COPY");
  }
  free(bytes);
  if (fcntl(executable, F_ADD_SEALS,
            F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK | F_SEAL_SEAL) != 0 ||
      fcntl(executable, F_GET_SEALS) !=
          (F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK | F_SEAL_SEAL)) {
    (void)close(source);
    (void)close(executable);
    return deny("MEMFD_SEAL");
  }

  unsigned char sealed_digest[SHA256_BYTES];
  unsigned char *sealed_bytes = malloc(executable_size);
  if (sealed_bytes == NULL || pread(executable, sealed_bytes, executable_size, 0) !=
                                  (ssize_t)executable_size ||
      hash_buffer(sealed_bytes, executable_size, sealed_digest) != 0 ||
      memcmp(source_digest, sealed_digest, SHA256_BYTES) != 0) {
    free(sealed_bytes);
    (void)close(source);
    (void)close(executable);
    return deny("SEALED_DIGEST");
  }
  free(sealed_bytes);

  if (strcmp(mode, "tamper-after-copy") == 0 && fchmod(source, 0700) != 0) {
    (void)close(source);
    (void)close(executable);
    return deny("TAMPER_SETUP");
  }
  if (strcmp(mode, "replace-after-copy") == 0) {
    char replacement_path[4096];
    int replacement_length =
        snprintf(replacement_path, sizeof(replacement_path), "%s.replacement", fixture_path);
    if (replacement_length <= 0 || (size_t)replacement_length >= sizeof(replacement_path) ||
        rename(replacement_path, fixture_path) != 0) {
      (void)close(source);
      (void)close(executable);
      return deny("REPLACE_SETUP");
    }
  }
  struct stat final_source;
  int current_path = open(fixture_path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  struct stat current;
  if (fstat(source, &final_source) != 0 || !metadata_equal(&initial, &final_source) ||
      current_path < 0 || fstat(current_path, &current) != 0 ||
      !metadata_equal(&final_source, &current)) {
    if (current_path >= 0) (void)close(current_path);
    (void)close(source);
    (void)close(executable);
    return deny("METADATA_REVALIDATION");
  }
  unsigned char *revalidated_bytes = malloc(executable_size);
  unsigned char revalidated_digest[SHA256_BYTES];
  if (revalidated_bytes == NULL ||
      pread(source, revalidated_bytes, executable_size, 0) != (ssize_t)executable_size ||
      hash_buffer(revalidated_bytes, executable_size, revalidated_digest) != 0 ||
      memcmp(revalidated_digest, expected_digest, SHA256_BYTES) != 0 ||
      memcmp(revalidated_digest, sealed_digest, SHA256_BYTES) != 0) {
    free(revalidated_bytes);
    (void)close(current_path);
    (void)close(source);
    (void)close(executable);
    return deny("DIGEST_REVALIDATION");
  }
  free(revalidated_bytes);
  (void)close(current_path);
  (void)close(source);

  int root = open(root_path, O_PATH | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  struct stat root_metadata;
  if (root < 0 || fstat(root, &root_metadata) != 0 ||
      root_metadata.st_uid != geteuid() || root_metadata.st_gid != getegid() ||
      (root_metadata.st_mode & 07777) != 0700) {
    if (root >= 0) (void)close(root);
    (void)close(executable);
    return deny("ROOT_METADATA");
  }
  const struct open_how working_how = {
      .flags = O_PATH | O_DIRECTORY | O_CLOEXEC,
      .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV,
  };
  int working_directory =
      (int)syscall(SYS_openat2, root, "work", &working_how, sizeof(working_how));
  struct stat working_metadata;
  if (working_directory < 0 || fstat(working_directory, &working_metadata) != 0 ||
      working_metadata.st_uid != geteuid() || working_metadata.st_gid != getegid() ||
      (working_metadata.st_mode & 07777) != 0700) {
    if (working_directory >= 0) (void)close(working_directory);
    (void)close(root);
    (void)close(executable);
    return deny("WORKDIR_METADATA");
  }
  if (strcmp(mode, "normal") == 0) {
    if (renameat(root, "work", root, "work-retained") != 0 ||
        mkdirat(root, "work", 0700) != 0) {
      (void)close(root);
      (void)close(working_directory);
      (void)close(executable);
      return deny("WORKDIR_SWAP");
    }
    int replacement_marker =
        openat(root, "work/fixture.marker", O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (replacement_marker < 0 ||
        write_all(replacement_marker, (const unsigned char *)"untrust", 7) != 0) {
      if (replacement_marker >= 0) (void)close(replacement_marker);
      (void)close(root);
      (void)close(working_directory);
      (void)close(executable);
      return deny("WORKDIR_SWAP");
    }
    (void)close(replacement_marker);
  }
  (void)close(root);

  int status_pipe[2];
  int ready_pipe[2];
  if (pipe2(status_pipe, O_CLOEXEC) != 0) {
    (void)close(working_directory);
    (void)close(executable);
    return deny("PIPE");
  }
  if (pipe2(ready_pipe, O_CLOEXEC) != 0) {
    (void)close(status_pipe[0]);
    (void)close(status_pipe[1]);
    (void)close(working_directory);
    (void)close(executable);
    return deny("PIPE");
  }
  if (!permit_is_current(expires_at_ms)) {
    (void)close(status_pipe[0]);
    (void)close(status_pipe[1]);
    (void)close(ready_pipe[0]);
    (void)close(ready_pipe[1]);
    (void)close(working_directory);
    (void)close(executable);
    return deny("PERMIT_EXPIRED");
  }
  pid_t child = fork();
  if (child < 0) {
    (void)close(status_pipe[0]);
    (void)close(status_pipe[1]);
    (void)close(ready_pipe[0]);
    (void)close(ready_pipe[1]);
    (void)close(working_directory);
    (void)close(executable);
    return deny("FORK");
  }
  if (child == 0) {
    (void)close(status_pipe[0]);
    (void)close(ready_pipe[0]);
    child_exec(executable, working_directory, status_pipe[1], ready_pipe[1]);
  }

  (void)close(status_pipe[1]);
  (void)close(ready_pipe[1]);
  (void)close(working_directory);
  (void)close(executable);
  (void)setpgid(child, child);
  int pidfd = (int)syscall(SYS_pidfd_open, child, 0);
  if (pidfd < 0) {
    force_cleanup(child, pidfd);
    (void)close(status_pipe[0]);
    (void)close(ready_pipe[0]);
    return deny("PIDFD_OPEN");
  }

  struct pollfd exec_monitor = {.fd = status_pipe[0], .events = POLLIN | POLLHUP};
  int exec_poll = poll(&exec_monitor, 1, EXEC_TIMEOUT_MS);
  unsigned char exec_error[sizeof(int)] = {0};
  ssize_t exec_bytes = exec_poll > 0 ? read(status_pipe[0], exec_error, sizeof(exec_error)) : -1;
  (void)close(status_pipe[0]);
  if (exec_poll <= 0 || exec_bytes != 0) {
    force_cleanup(child, pidfd);
    (void)close(pidfd);
    (void)close(ready_pipe[0]);
    return deny("EXECVEAT_STATUS");
  }

  struct pollfd ready_monitor = {.fd = ready_pipe[0], .events = POLLIN};
  char ready[7] = {0};
  int ready_poll = poll(&ready_monitor, 1, READY_TIMEOUT_MS);
  ssize_t ready_bytes = ready_poll > 0 ? read(ready_pipe[0], ready, 6) : -1;
  (void)close(ready_pipe[0]);
  if (ready_bytes != 6 || memcmp(ready, "READY\n", 6) != 0) {
    force_cleanup(child, pidfd);
    (void)close(pidfd);
    return deny("FIXTURE_READY");
  }

  if (kill(-child, SIGTERM) != 0) {
    force_cleanup(child, pidfd);
    (void)close(pidfd);
    return deny("TERM");
  }
  struct pollfd process_monitor = {.fd = pidfd, .events = POLLIN};
  if (poll(&process_monitor, 1, TERM_GRACE_MS) != 0) {
    force_cleanup(child, pidfd);
    (void)close(pidfd);
    return deny("TERM_NOT_IGNORED");
  }
  int kill_poll = 0;
  if (kill(-child, SIGKILL) != 0 ||
      (kill_poll = poll(&process_monitor, 1, KILL_TIMEOUT_MS)) <= 0 ||
      (process_monitor.revents & POLLIN) == 0) {
    force_cleanup(child, pidfd);
    (void)close(pidfd);
    return deny("KILL_TIMEOUT");
  }
  int child_status = 0;
  if (wait_child_bounded(child, &child_status) != 0 || !WIFSIGNALED(child_status) ||
      WTERMSIG(child_status) != SIGKILL) {
    force_cleanup(child, pidfd);
    (void)close(pidfd);
    return deny("KILL_STATUS");
  }
  reap_process_group(child);
  (void)close(pidfd);
  for (int attempt = 0; attempt < 100 && kill(-child, 0) == 0; attempt += 1) {
    const struct timespec delay = {.tv_sec = 0, .tv_nsec = 10000000};
    (void)nanosleep(&delay, NULL);
    reap_process_group(child);
  }
  if (kill(-child, 0) == 0 || errno != ESRCH) return deny("PROCESS_GROUP_REMAINS");

  char source_hex[65];
  char sealed_hex[65];
  encode_hex(source_digest, source_hex);
  encode_hex(sealed_digest, sealed_hex);
  int evidence_length = snprintf(
      evidence_output, 1024,
      "{\"schemaVersion\":1,\"sourceDigest\":\"%s\",\"sealedDigest\":\"%s\","
      "\"execveatSucceeded\":true,\"emptyEnvironment\":true,\"noNewPrivileges\":true,"
      "\"resourceLimitsVerified\":true,\"socketDeniedBySeccomp\":true,"
      "\"childCreationDeniedBySeccomp\":true,\"sessionEscapeDeniedBySeccomp\":true,"
      "\"retainedWorkingDirectoryVerified\":true,"
      "\"termEscalatedToKill\":true,\"pidfdObservedExit\":true,"
      "\"processGroupGone\":true}\n",
      source_hex, sealed_hex);
  if (evidence_length <= 0 || evidence_length >= 1024) return deny("EVIDENCE_OUTPUT");
  return 0;
}

#ifndef VENTUREOS_NATIVE_ADDON
int main(int argc, char **argv) {
  char evidence[1024] = {0};
  int status = run_supervisor(argc, argv, evidence);
  if (status == 0 && fputs(evidence, stdout) == EOF) return deny("EVIDENCE_WRITE");
  return status;
}
#endif
