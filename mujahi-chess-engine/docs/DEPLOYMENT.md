# Deployment Guide (GitHub + Render + Vercel — Zero Local Terminal Required)

Everything below can be performed using only the GitHub, Render.com, and Vercel web dashboards.

---

## Step 1: Push Repository to GitHub

1. Create a new GitHub repository (e.g., `mujahi-chess-engine`).
2. Upload or push the contents of `/mujahi-chess-engine/` so `api/`, `website/`, `docs/`, `examples/`, and `LICENSES/` sit at the repository root.

---

## Step 2: Deploy Docker Backend on Render.com

1. Open the **Render Dashboard** -> **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure service settings:
   - **Root Directory**: `api`
   - **Runtime**: `Docker`
   - **Dockerfile Path**: `Dockerfile` (auto-detected inside `api/`)
   - **Health Check Path**: `/health`
   - **Instance Type**:
     - **Free (`0.1 vCPU`, `512 MB RAM`)**: Suitable for initial testing and cold verification. Spins down after 15 minutes of inactivity (15–50s wake-up delay) and throttles CPU under continuous search.
     - **Starter (`0.5 vCPU`, `512 MB RAM`)**: Recommended baseline for live Chess Helper extension play without idle spin-down.
4. Add **Environment Variables**:
   - `NODE_ENV` = `production`
   - `PORT` = `10000`
   - `ENGINE_THREADS` = `1`
   - `ENGINE_HASH_MB` = `64`
   - `ENGINE_TIMEOUT_MS` = `45000`
   - `ENGINE_MAX_DEPTH` = `20`
   - `CORS_ALLOWED_ORIGINS` = `https://your-vercel-project.vercel.app` (replace with your exact Vercel URL after Step 3; comma-separate multiple domains if needed)
5. Click **Deploy Web Service**. Note your Render URL (e.g. `https://mujahi-chess.onrender.com`).

> **Note**: Do **not** add `https://www.chess.com` to `CORS_ALLOWED_ORIGINS`. The Chess Helper Chrome extension communicates through its Manifest V3 background service worker using `host_permissions`, keeping browser CORS restricted strictly to your frontend domain.

---

## Step 3: Deploy Static Frontend on Vercel

1. Before deploying (or directly in the GitHub web editor), edit `website/config.js`:
   ```js
   window.MUJAHI_CONFIG = Object.freeze({
     API_BASE_URL: 'https://your-render-service.onrender.com',
     EXTENSION_DOWNLOAD_URL: '',
     EXTENSION_VERSION: '2.1.0',
     SITE_NAME: 'MUJAHI Chess Engine',
   });
   ```
2. Open the **Vercel Dashboard** -> **Add New...** -> **Project**.
3. Import your GitHub repository.
4. Set **Root Directory** to `website`.
5. Set **Framework Preset** to `Other` (no build command, output directory `.`).
6. Click **Deploy**.
7. Copy the deployed Vercel URL (`https://your-project.vercel.app`) and update `CORS_ALLOWED_ORIGINS` in Render's Environment tab.

---

## Step 4: Verify Live Deployment

1. Open `https://your-render-service.onrender.com/health` in your browser and confirm `"status": "ok"` and `"tag": "sf_19"`.
2. Open your Vercel site -> **Status** page and click **Refresh Probe**.
3. Open **Analysis**, select **SSE Stream**, and run a test FEN evaluation.
