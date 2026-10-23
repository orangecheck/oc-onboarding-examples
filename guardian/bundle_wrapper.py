"""Write a shell wrapper that runs a binary from an unpacked fedimint nix bundle.

The pinned fedimintd and fedimint-cli releases are nix bundles. Unpacked with
`--extract`, their binaries still name /nix/store/... for the loader and the
libraries, and the bundle's own launcher needs unprivileged user namespaces.
The wrapper calls the bundle's loader directly, with the library path the
binary's RUNPATH names, mapped into the unpacked store.

usage: python3 -I bundle_wrapper.py <unpacked nix/store dir> <binary name> <wrapper path>
"""
import os
import struct
import sys

NIX = "/nix/store/"


def elf(path):
    with open(path, "rb") as f:
        head = f.read(64)
        if head[:4] != b"\x7fELF" or head[4] != 2 or head[5] != 1:
            sys.exit(f"{path}: not a 64-bit little-endian ELF")
        phoff, = struct.unpack_from("<Q", head, 0x20)
        phentsize, phnum = struct.unpack_from("<HH", head, 0x36)
        f.seek(phoff)
        phs = [struct.unpack("<IIQQQQQQ", f.read(phentsize)[:56]) for _ in range(phnum)]
        interp, dyn, loads = None, None, []
        for p_type, _, off, vaddr, _, filesz, _, _ in phs:
            if p_type == 1:
                loads.append((vaddr, off, filesz))
            elif p_type == 2:
                dyn = (off, filesz)
            elif p_type == 3:
                f.seek(off)
                interp = f.read(filesz).rstrip(b"\0").decode()
        needed, runpath, strtab = [], [], None
        if dyn:
            f.seek(dyn[0])
            raw = f.read(dyn[1])
            entries = [struct.unpack_from("<qQ", raw, i) for i in range(0, len(raw) - 15, 16)]
            for tag, val in entries:
                if tag == 5:
                    strtab = next(o + val - v for v, o, n in loads if v <= val < v + n)

            def string(off):
                f.seek(strtab + off)
                return f.read(4096).split(b"\0", 1)[0].decode()

            for tag, val in entries:
                if tag == 1:
                    needed.append(string(val))
                elif tag in (15, 29):
                    runpath += string(val).split(":")
        return interp, needed, runpath


def main():
    store, name, out = sys.argv[1:4]
    store = os.path.abspath(store)

    def local(p):
        return os.path.join(store, p[len(NIX):]) if p.startswith(NIX) else p

    found = [os.path.join(store, d, "bin", name) for d in sorted(os.listdir(store))
             if os.path.isfile(os.path.join(store, d, "bin", name))]
    if len(found) != 1:
        sys.exit(f"expected one {name} under {store}, found {len(found)}")
    binary = found[0]
    interp, _, _ = elf(binary)
    if not interp or not interp.startswith(NIX):
        sys.exit(f"{binary}: loader {interp!r} is not in a nix store")

    dirs, queue, seen = [], [binary], set()
    while queue:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        _, needed, runpath = elf(path)
        for d in map(local, filter(None, runpath)):
            if d not in dirs:
                dirs.append(d)
        for lib in needed:
            for d in dirs:
                cand = os.path.join(d, lib)
                # A store symlink can point at another store path by its absolute name.
                while os.path.islink(cand) and os.readlink(cand).startswith(NIX):
                    cand = local(os.readlink(cand))
                    if os.path.dirname(cand) not in dirs:
                        dirs.append(os.path.dirname(cand))
                if os.path.exists(cand):
                    queue.append(os.path.realpath(cand))
                    break
            else:
                sys.exit(f"{lib} (needed by {path}) is not in the unpacked store")

    with open(out, "w") as w:
        w.write("#!/bin/sh\n")
        w.write(f"exec '{local(interp)}' --library-path '{':'.join(dirs)}' '{binary}' \"$@\"\n")
    os.chmod(out, 0o755)


main()
