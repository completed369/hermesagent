#!/usr/bin/env python3
"""Fail-closed content checks for a Docker rootfs tar stream."""

from __future__ import annotations

import re
import sys
import tarfile
from pathlib import PurePosixPath

SECRET_PATTERN = re.compile(
    rb"BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20}|sk-ant-[A-Za-z0-9_-]{20}"
)
DEVELOPMENT_ONLY_PACKAGES = {
    "@playwright/test",
    "dotenv-cli",
    "eslint",
    "prettier",
    "rimraf",
    "tsx",
    "turbo",
    "typescript",
    "vite",
    "vitest",
}
TARGETS = {
    "api": ({"app/dist/main.js"}, set(), set()),
    "worker": ({"app/dist/index.js"}, set(), set()),
    "web": ({"app/apps/web/server.js"}, {"app/apps/web/.next/static"}, set()),
    "tools": (
        {"app/prisma/schema.prisma"},
        set(),
        {"/node_modules/prisma/build/index.js"},
    ),
    "ingress": ({"app/staging-ingress-proxy.mjs"}, set(), set()),
}


def normalize(name: str) -> str:
    return name.removeprefix("./").removeprefix("/")


def fail(message: str) -> None:
    raise SystemExit(message)


def package_names(parts: tuple[str, ...]) -> set[str]:
    """Return package identities from real or pnpm-virtual node_modules paths."""
    packages: set[str] = set()
    for index, part in enumerate(parts[:-1]):
        if part != "node_modules":
            continue
        first = parts[index + 1]
        if first == ".pnpm":
            continue
        if first.startswith("@") and index + 2 < len(parts):
            packages.add(f"{first}/{parts[index + 2]}")
        else:
            packages.add(first)
    return packages


def is_third_party_pnpm_content(parts: tuple[str, ...]) -> bool:
    """Allow dependency-owned tests only inside pnpm's isolated third-party store."""
    if parts[:3] != ("app", "node_modules", ".pnpm"):
        return False
    packages = package_names(parts)
    return bool(packages) and not any(package.startswith("@ventureos/") for package in packages)


def contains_secret(source: object) -> bool:
    """Scan a file stream without loading an arbitrarily large member into memory."""
    overlap = b""
    while chunk := source.read(64 * 1024):
        candidate = overlap + chunk
        if SECRET_PATTERN.search(candidate):
            return True
        overlap = candidate[-256:]
    return False


def temporal_prohibited_content(parts: tuple[str, ...]) -> str | None:
    for index in range(len(parts) - 2):
        if parts[index : index + 3] != ("node_modules", "@temporalio", "core-bridge"):
            continue
        remaining = parts[index + 3 :]
        for prohibited in ("sdk-core", "bridge-macros", "Cargo.lock", "Cargo.toml"):
            if prohibited in remaining:
                return prohibited
    return None


def scarf_compile_cache(parts: tuple[str, ...]) -> bool:
    for index in range(len(parts) - 3):
        if parts[index : index + 3] != ("node_modules", "@scarf", "scarf"):
            continue
        if "node-compile-cache" in parts[index + 3 :]:
            return True
    return False


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in TARGETS:
        fail("usage: verify-image-rootfs.py <api|worker|web|tools|ingress>")

    target = sys.argv[1]
    required_files, required_dirs, required_suffixes = TARGETS[target]
    seen_files: set[str] = set()
    seen_dirs: set[str] = set()

    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|*") as archive:
        for member in archive:
            name = normalize(member.name)
            path = PurePosixPath(name)
            parts = path.parts
            if not parts or parts[0] != "app":
                continue

            if ".git" in parts:
                fail(f"{target}: forbidden .git content: {name}")
            if path.name == ".env" or path.name.startswith(".env."):
                fail(f"{target}: forbidden environment file: {name}")
            if (".test." in path.name or ".spec." in path.name) and not is_third_party_pnpm_content(
                parts
            ):
                fail(f"{target}: forbidden first-party test file: {name}")

            packages = package_names(parts)
            development_packages = sorted(
                package
                for package in packages
                if package in DEVELOPMENT_ONLY_PACKAGES
                or package.startswith(("@types/", "@typescript-eslint/", "@vitest/"))
            )
            if development_packages:
                fail(
                    f"{target}: forbidden development-only runtime package "
                    f"{development_packages[0]}: {name}"
                )

            temporal_content = temporal_prohibited_content(parts) if target == "worker" else None
            if temporal_content:
                fail(f"{target}: scan-only Temporal {temporal_content} remains: {name}")
            if scarf_compile_cache(parts):
                fail(f"{target}: generated Scarf node-compile-cache remains: {name}")
            if target == "tools" and (name == "app/src" or name.startswith("app/src/")):
                fail(f"{target}: forbidden source directory: {name}")

            if member.isdir():
                seen_dirs.add(name.rstrip("/"))
            elif member.isfile():
                if member.size > 0:
                    seen_files.add(name)
                source = archive.extractfile(member)
                if source is not None and contains_secret(source):
                    fail(f"{target}: secret-like content detected: {name}")

    missing_files = sorted(required_files - seen_files)
    missing_dirs = sorted(
        required
        for required in required_dirs
        if required not in seen_dirs
        and not any(name.startswith(f"{required}/") for name in seen_files | seen_dirs)
    )
    missing_suffixes = sorted(
        suffix for suffix in required_suffixes if not any(name.endswith(suffix) for name in seen_files)
    )
    if missing_files or missing_dirs or missing_suffixes:
        fail(
            f"{target}: missing required runtime content; "
            f"files={missing_files}, directories={missing_dirs}, suffixes={missing_suffixes}"
        )

    print(f"IMAGE_ROOTFS_CONTENT_PASS target={target}")


if __name__ == "__main__":
    main()
