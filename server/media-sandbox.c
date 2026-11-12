#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

// Bookworm headers predate Landlock ABI 3; only request this bit when supported.
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

#if defined(__x86_64__)
#define SANDBOX_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define SANDBOX_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported media sandbox architecture
#endif

static int allow_path(int ruleset, const char *path, uint64_t rights) {
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) return errno == ENOENT ? 0 : -1;
    struct stat st;
    if (fstat(fd, &st) < 0) { close(fd); return -1; }
    if (!S_ISDIR(st.st_mode)) rights &= ~LANDLOCK_ACCESS_FS_READ_DIR;
    struct landlock_path_beneath_attr rule = { .allowed_access = rights, .parent_fd = fd };
    int result = syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
    close(fd);
    return result;
}

static int restrict_files(int transcript, int poster) {
    int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 1) return -1;
    uint64_t handled = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE |
        LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |
        LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
        LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |
        LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |
        LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM;
    if (abi >= 2) handled |= LANDLOCK_ACCESS_FS_REFER;
    if (abi >= 3) handled |= LANDLOCK_ACCESS_FS_TRUNCATE;
    struct landlock_ruleset_attr attr = { .handled_access_fs = handled };
    int ruleset = syscall(SYS_landlock_create_ruleset, &attr, sizeof(attr), 0);
    if (ruleset < 0) return -1;
    const uint64_t read = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
    const char *paths[] = {
        "/etc/ld.so.cache", "/etc/ssl/openssl.cnf",
        "/app/node_modules", "/app/package.json", "/app/server/media-sniff.mjs",
        "/dev/urandom", "/dev/random", "/proc/meminfo", "/proc/cpuinfo",
        "/proc/self/stat", "/proc/self/status", "/proc/self/maps"
    };
    int result = allow_path(ruleset, poster ? "/usr/bin/ffmpeg" : transcript ? "/opt/kakuoku-youtube/bin/python3" : "/usr/local/bin/node", read | LANDLOCK_ACCESS_FS_EXECUTE);
    const char *libraries[] = { "/lib", "/lib64", "/usr/lib" };
    for (size_t i = 0; result == 0 && i < sizeof(libraries) / sizeof(libraries[0]); i++) result = allow_path(ruleset, libraries[i], read | LANDLOCK_ACCESS_FS_EXECUTE);
    for (size_t i = 0; result == 0 && i < sizeof(paths) / sizeof(paths[0]); i++) result = allow_path(ruleset, paths[i], read);
    if (transcript && result == 0) result = allow_path(ruleset, "/opt/kakuoku-youtube", read);
    if (transcript && result == 0) result = allow_path(ruleset, "/app/server/youtube-worker.py", read);
    if (poster && result == 0) {
        result = allow_path(ruleset, "/proc/self/fd/3", LANDLOCK_ACCESS_FS_READ_FILE);
    }
    if (result == 0) result = syscall(SYS_landlock_restrict_self, ruleset, 0);
    close(ruleset);
    return result;
}

#define DENY_NR(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (n), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
static int restrict_syscalls(void) {
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SANDBOX_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        // Reject alternate syscall tables such as x32 as well.
        BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, 0x40000000, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
        DENY_NR(SYS_socket), DENY_NR(SYS_socketpair), DENY_NR(SYS_connect),
        DENY_NR(SYS_bind), DENY_NR(SYS_listen), DENY_NR(SYS_accept), DENY_NR(SYS_accept4),
        DENY_NR(SYS_sendto), DENY_NR(SYS_sendmsg), DENY_NR(SYS_sendmmsg),
        DENY_NR(SYS_recvfrom), DENY_NR(SYS_recvmsg), DENY_NR(SYS_recvmmsg),
        DENY_NR(SYS_ptrace), DENY_NR(SYS_process_vm_readv), DENY_NR(SYS_process_vm_writev),
        DENY_NR(SYS_pidfd_getfd), DENY_NR(SYS_io_uring_setup),
        DENY_NR(SYS_io_uring_enter), DENY_NR(SYS_io_uring_register),
        DENY_NR(SYS_fchmod), DENY_NR(SYS_fchmodat), DENY_NR(SYS_fchown), DENY_NR(SYS_fchownat),
        DENY_NR(SYS_truncate), DENY_NR(SYS_ftruncate), DENY_NR(SYS_utimensat),
        DENY_NR(SYS_kill), DENY_NR(SYS_tkill), DENY_NR(SYS_pidfd_send_signal),
#ifdef SYS_chmod
        DENY_NR(SYS_chmod),
#endif
#ifdef SYS_chown
        DENY_NR(SYS_chown), DENY_NR(SYS_lchown),
#endif
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
    };
    struct sock_fprog program = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
    return prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program);
}

int main(int argc, char **argv) {
    // Fail closed: no shell, model-controlled command, privileges or fallback.
    if (argc < 2) return 125;
    int transcript = strcmp(argv[1], "/opt/kakuoku-youtube/bin/python3") == 0;
    int poster = strcmp(argv[1], "/usr/bin/ffmpeg") == 0;
    int image = poster && argc == 3 && strcmp(argv[2], "--image") == 0;
    if (poster) {
        struct stat input;
        if ((!image && argc != 2) || fstat(3, &input) || !S_ISREG(input.st_mode) || input.st_nlink != 1 || input.st_size <= 0 || input.st_size > 128 * 1024 * 1024 || (fcntl(3, F_GETFL) & O_ACCMODE) != O_RDONLY) return 125;
    } else if (transcript) {
        if (argc != 5 || strcmp(argv[2], "-I") || strcmp(argv[3], "-B") || strcmp(argv[4], "/app/server/youtube-worker.py")) return 125;
    } else if (strcmp(argv[1], "/usr/local/bin/node") != 0) return 125;
    struct rlimit descriptors;
    if (getrlimit(RLIMIT_NOFILE, &descriptors) || descriptors.rlim_max > 65536) return 125;
    for (rlim_t fd = poster ? 4 : 3; fd < descriptors.rlim_max; fd++) close((int)fd);
    struct rlimit cpu = { .rlim_cur = poster ? 8 : 3, .rlim_max = poster ? 8 : 3 };
    struct rlimit core = { .rlim_cur = 0, .rlim_max = 0 };
    struct rlimit memory = { .rlim_cur = (poster ? 512UL : 256UL) * 1024 * 1024, .rlim_max = (poster ? 512UL : 256UL) * 1024 * 1024 };
    if ((transcript || poster) && setrlimit(RLIMIT_AS, &memory)) return 125;
    if (setrlimit(RLIMIT_CPU, &cpu) || setrlimit(RLIMIT_CORE, &core) ||
        prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || restrict_files(transcript, poster) || restrict_syscalls()) return 125;
    int data = open("/app/data", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (data >= 0) { close(data); return 125; }
    if (errno != EACCES || socket(AF_INET, SOCK_STREAM, 0) >= 0 || errno != EPERM) return 125;
    if (poster) {
        char *args[] = { "/usr/bin/ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-max_alloc", "33554432", "-threads", "1", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", "-format_whitelist", image ? "png_pipe,jpeg_pipe,webp_pipe,gif" : "mov,matroska,webm", "-i", "/proc/self/fd/3", "-map", "0:v:0", "-frames:v", "1", "-vf", image ? "scale=w='min(1600,iw)':h='min(1600,ih)':force_original_aspect_ratio=decrease" : "scale=640:640:force_original_aspect_ratio=decrease", "-an", "-sn", "-dn", "-c:v", "mjpeg", "-threads", "1", "-f", "image2pipe", "pipe:1", NULL };
        execv(args[0], args);
    } else execv(argv[1], &argv[1]);
    return 125;
}
