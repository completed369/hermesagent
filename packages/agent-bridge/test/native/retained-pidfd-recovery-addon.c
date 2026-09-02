#define _GNU_SOURCE
#define NAPI_VERSION 8

#include <errno.h>
#include <fcntl.h>
#include <node_api.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#ifndef SYS_pidfd_open
#error "pidfd_open syscall number is required"
#endif

struct retained_launch {
  pid_t leader;
  pid_t process_group;
  int pidfd;
  int exit_time_pipe;
  int active;
  char supervision_id[257];
  char launch_nonce[257];
  int64_t identity_established_at_ms;
};

static struct retained_launch launch_state = {.pidfd = -1, .exit_time_pipe = -1};

static int64_t realtime_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_REALTIME, &now) != 0)
    return -1;
  return (int64_t)now.tv_sec * 1000 + now.tv_nsec / 1000000;
}

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

static napi_value deny(napi_env env) {
  (void)napi_throw_error(env, "RETAINED_PIDFD_DENIED", "Retained pidfd authority denied");
  return NULL;
}

static void close_state(void) {
  if (launch_state.pidfd >= 0)
    (void)close(launch_state.pidfd);
  if (launch_state.exit_time_pipe >= 0)
    (void)close(launch_state.exit_time_pipe);
  launch_state.pidfd = -1;
  launch_state.exit_time_pipe = -1;
  launch_state.active = 0;
}

static void cleanup_group(void) {
  if (launch_state.process_group > 0) {
    (void)kill(-launch_state.process_group, SIGKILL);
    for (int attempt = 0; attempt < 100; attempt += 1) {
      int status = 0;
      while (waitpid(-launch_state.process_group, &status, WNOHANG) > 0) {
      }
      if (kill(-launch_state.process_group, 0) != 0 && errno == ESRCH)
        break;
      struct timespec pause = {.tv_sec = 0, .tv_nsec = 2000000};
      (void)nanosleep(&pause, NULL);
    }
  }
  if (launch_state.leader > 0) {
    int status = 0;
    (void)waitpid(launch_state.leader, &status, WNOHANG);
  }
  close_state();
}

static void environment_cleanup(void *ignored) {
  (void)ignored;
  if (launch_state.active)
    cleanup_group();
}

static napi_value launch_fixture(napi_env env, napi_callback_info info) {
  napi_value values[2];
  char supervision_id[257];
  char launch_nonce[257];
  int timestamps[2] = {-1, -1};
  if (launch_state.active || exact_argc(env, info, 2, values) != 0 ||
      exact_string(env, values[0], supervision_id, sizeof(supervision_id)) != 0 ||
      exact_string(env, values[1], launch_nonce, sizeof(launch_nonce)) != 0)
    return deny(env);
  if (pipe2(timestamps, O_CLOEXEC) != 0)
    return deny(env);
  if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0) {
    (void)close(timestamps[0]);
    (void)close(timestamps[1]);
    return deny(env);
  }

  pid_t leader = fork();
  if (leader < 0) {
    (void)close(timestamps[0]);
    (void)close(timestamps[1]);
    return deny(env);
  }
  if (leader == 0) {
    (void)close(timestamps[0]);
    if (setpgid(0, 0) != 0)
      _exit(120);
    pid_t descendant = fork();
    if (descendant < 0)
      _exit(121);
    if (descendant == 0) {
      (void)close(timestamps[1]);
      for (;;)
        pause();
    }
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 50000000};
    (void)nanosleep(&delay, NULL);
    int64_t exited_at_ms = realtime_ms();
    if (exited_at_ms < 0 ||
        write(timestamps[1], &exited_at_ms, sizeof(exited_at_ms)) !=
            (ssize_t)sizeof(exited_at_ms))
      _exit(122);
    (void)close(timestamps[1]);
    _exit(0);
  }

  (void)close(timestamps[1]);
  (void)setpgid(leader, leader);
  int pidfd = (int)syscall(SYS_pidfd_open, leader, 0);
  int64_t established = realtime_ms();
  if (pidfd < 0 || established < 0) {
    launch_state.leader = leader;
    launch_state.process_group = leader;
    launch_state.exit_time_pipe = timestamps[0];
    cleanup_group();
    return deny(env);
  }
  launch_state.leader = leader;
  launch_state.process_group = leader;
  launch_state.pidfd = pidfd;
  launch_state.exit_time_pipe = timestamps[0];
  launch_state.active = 1;
  launch_state.identity_established_at_ms = established;
  (void)snprintf(launch_state.supervision_id, sizeof(launch_state.supervision_id), "%s",
                 supervision_id);
  (void)snprintf(launch_state.launch_nonce, sizeof(launch_state.launch_nonce), "%s", launch_nonce);

  napi_value result;
  if (napi_create_int64(env, established, &result) != napi_ok) {
    cleanup_group();
    return deny(env);
  }
  return result;
}

static int add_int64(napi_env env, napi_value object, const char *name, int64_t value) {
  napi_value field;
  return napi_create_int64(env, value, &field) == napi_ok &&
                 napi_set_named_property(env, object, name, field) == napi_ok
             ? 0
             : -1;
}

static napi_value observe_and_cleanup(napi_env env, napi_callback_info info) {
  napi_value values[5];
  char request_id[257];
  char request_hash[65];
  char challenge_nonce[65];
  char supervision_id[257];
  char launch_nonce[257];
  if (!launch_state.active || exact_argc(env, info, 5, values) != 0 ||
      exact_string(env, values[0], request_id, sizeof(request_id)) != 0 ||
      exact_string(env, values[1], request_hash, sizeof(request_hash)) != 0 ||
      exact_string(env, values[2], challenge_nonce, sizeof(challenge_nonce)) != 0 ||
      exact_string(env, values[3], supervision_id, sizeof(supervision_id)) != 0 ||
      exact_string(env, values[4], launch_nonce, sizeof(launch_nonce)) != 0 ||
      strcmp(supervision_id, launch_state.supervision_id) != 0 ||
      strcmp(launch_nonce, launch_state.launch_nonce) != 0)
    return deny(env);

  struct pollfd retained = {.fd = launch_state.pidfd, .events = POLLIN};
  if (poll(&retained, 1, 1000) != 1 || (retained.revents & POLLIN) == 0) {
    cleanup_group();
    return deny(env);
  }
  int64_t identity_verified_at_ms = realtime_ms();
  int64_t exited_at_ms = -1;
  if (identity_verified_at_ms < 0 ||
      read(launch_state.exit_time_pipe, &exited_at_ms, sizeof(exited_at_ms)) !=
          (ssize_t)sizeof(exited_at_ms) ||
      exited_at_ms < launch_state.identity_established_at_ms ||
      identity_verified_at_ms < exited_at_ms) {
    cleanup_group();
    return deny(env);
  }
  int status = 0;
  if (waitpid(launch_state.leader, &status, 0) != launch_state.leader || !WIFEXITED(status) ||
      WEXITSTATUS(status) != 0) {
    cleanup_group();
    return deny(env);
  }
  int64_t observed_at_ms = realtime_ms();
  (void)kill(-launch_state.process_group, SIGTERM);
  for (int attempt = 0; attempt < 100; attempt += 1) {
    while (waitpid(-launch_state.process_group, &status, WNOHANG) > 0) {
    }
    if (kill(-launch_state.process_group, 0) != 0 && errno == ESRCH)
      break;
    if (attempt == 49)
      (void)kill(-launch_state.process_group, SIGKILL);
    struct timespec pause = {.tv_sec = 0, .tv_nsec = 2000000};
    (void)nanosleep(&pause, NULL);
  }
  while (waitpid(-launch_state.process_group, &status, WNOHANG) > 0) {
  }
  if (kill(-launch_state.process_group, 0) == 0 || errno != ESRCH) {
    cleanup_group();
    return deny(env);
  }
  int64_t cleanup_completed_at_ms = realtime_ms();
  if (observed_at_ms < identity_verified_at_ms || cleanup_completed_at_ms < observed_at_ms) {
    cleanup_group();
    return deny(env);
  }

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok ||
      add_int64(env, result, "identityEstablishedAtMs", launch_state.identity_established_at_ms) !=
          0 ||
      add_int64(env, result, "identityVerifiedAtMs", identity_verified_at_ms) != 0 ||
      add_int64(env, result, "exitedAtMs", exited_at_ms) != 0 ||
      add_int64(env, result, "observedAtMs", observed_at_ms) != 0 ||
      add_int64(env, result, "cleanupCompletedAtMs", cleanup_completed_at_ms) != 0) {
    cleanup_group();
    return deny(env);
  }
  close_state();
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value launch_function;
  napi_value observe_function;
  if (napi_add_env_cleanup_hook(env, environment_cleanup, NULL) != napi_ok ||
      napi_create_function(env, "launch", NAPI_AUTO_LENGTH, launch_fixture, NULL,
                           &launch_function) != napi_ok ||
      napi_create_function(env, "observeAndCleanup", NAPI_AUTO_LENGTH, observe_and_cleanup, NULL,
                           &observe_function) != napi_ok ||
      napi_set_named_property(env, exports, "launch", launch_function) != napi_ok ||
      napi_set_named_property(env, exports, "observeAndCleanup", observe_function) != napi_ok)
    return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
