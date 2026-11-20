# Third-Party Notices and GPLv3 Compliance

## 1. Stockfish Chess Engine

- **Software**: Stockfish (Official Release)
- **Version / Tag**: `sf_19` (Stockfish 19, released September 5, 2026)
- **Pinned Git Commit**: `edb0d9db6731067ec50ce619ff372b463bc4dd5d`
- **Upstream Source Repository**: https://github.com/official-stockfish/Stockfish
- **License**: GNU General Public License v3.0 (GPLv3) — see `LICENSES/STOCKFISH-LICENSE.txt`
- **Source Modifications**: None. Stockfish 19 is cloned unmodified from the pinned upstream release commit and compiled from official C++ source inside `api/Dockerfile`.
- **Ownership Notice**: Stockfish is free software copyright (C) The Stockfish developers. MUJAHI Chess Engine API is an independent REST/SSE orchestration wrapper and web platform that communicates with the unmodified Stockfish binary over standard UCI (`stdin`/`stdout`). Stockfish is NOT proprietary MUJAHI software.

### NNUE Network Notice (Stockfish 19 SFNNv16)

- **Architecture**: SFNNv16 (single neural network; secondary small net retired in Stockfish 19)
- **Default Network Identifier (`EvalFileDefaultName`)**: `nn-1a298aa575a0.nnue`
- **Official Network Distribution**: Downloaded and SHA-256 verified during Docker build via Stockfish's official `make net` target (`https://tests.stockfishchess.org/api/nn/nn-1a298aa575a0.nnue`) and embedded into the compiled binary.
- **License**: Stockfish NNUE evaluation network weights distributed by the Stockfish project are covered by the Stockfish GPLv3 distribution terms (and CC0/public-domain-equivalent weights where specified upstream).

### Reproducing the Binary

From a Linux x86-64 build host with `git`, `g++`, `make`, and `curl`:

```bash
git clone https://github.com/official-stockfish/Stockfish.git
cd Stockfish
git checkout edb0d9db6731067ec50ce619ff372b463bc4dd5d
cd src
make net
make -j"$(nproc)" build ARCH=x86-64-sse41-popcnt
```

Verify the compiled binary prints `Stockfish 19` on `uci` and embeds `nn-1a298aa575a0.nnue`.

---

## 2. Node.js Runtime & NPM Dependencies (`api/package.json`)

- **Node.js**: Node.js 24 LTS (MIT License) — https://nodejs.org
- **express** (`4.21.2`): MIT License — https://expressjs.com
- **cors** (`2.8.5`): MIT License — https://github.com/expressjs/cors
- **helmet** (`8.1.0`): MIT License — https://helmetjs.github.io
- **express-rate-limit** (`7.5.1`): MIT License — https://github.com/express-rate-limit/express-rate-limit

---

## 3. Website Fonts (Optional CDN Link with System Fallbacks)

- **Plus Jakarta Sans**, **DM Sans**, **JetBrains Mono**: SIL Open Font License 1.1 (loaded with graceful local system font fallbacks if offline).
