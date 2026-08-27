#define _GNU_SOURCE

#if !defined(__linux__) || !defined(__x86_64__)
#error "The native runtime fixture requires Linux x86_64"
#endif

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>

extern char **environ;

static int limits_are_exact(void) {
  struct rlimit limit;
  if (getrlimit(RLIMIT_CORE, &limit) != 0 || limit.rlim_cur != 0 || limit.rlim_max != 0)
    return 0;
  if (getrlimit(RLIMIT_CPU, &limit) != 0 || limit.rlim_cur != 2 || limit.rlim_max != 2)
    return 0;
  if (getrlimit(RLIMIT_AS, &limit) != 0 || limit.rlim_cur != 64U * 1024U * 1024U ||
      limit.rlim_max != 64U * 1024U * 1024U)
    return 0;
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0 || limit.rlim_cur != 32 || limit.rlim_max != 32)
    return 0;
  if (getrlimit(RLIMIT_NPROC, &limit) != 0 || limit.rlim_cur != 8 || limit.rlim_max != 8)
    return 0;
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 3 || strcmp(argv[0], "ventureos-native-runtime-fixture") != 0 ||
      strcmp(argv[1], "--mode") != 0 || strcmp(argv[2], "jsonl-fixture") != 0)
    return 20;
  if (environ == NULL || environ[0] != NULL) return 21;
  if (prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1) return 22;
  if (!limits_are_exact()) return 23;

  char executable_path[256] = {0};
  ssize_t path_length = readlink("/proc/self/exe", executable_path, sizeof(executable_path) - 1);
  if (path_length <= 0 || strstr(executable_path, "memfd:ventureos-runtime-fixture") == NULL)
    return 24;

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
  if (signal(SIGTERM, SIG_IGN) == SIG_ERR) return 27;

  errno = 0;
  if (fork() >= 0 || errno != EPERM) return 28;
  errno = 0;
  if (syscall(SYS_setsid) >= 0 || errno != EPERM) return 29;
  errno = 0;
  if (syscall(SYS_setpgid, 0, 0) >= 0 || errno != EPERM) return 30;
  if (write(STDOUT_FILENO, "READY\n", 6) != 6) return 31;
  for (;;) pause();
}
