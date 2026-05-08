# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project

NAS duplicate file checker for Synology NAS (DS225+, DSM 7.3).

## NAS Constraints

- Hostname: aresvnas.synology.me
- Only ports 5000/5001 open externally — all other ports blocked
- No SSH access from outside LAN
- User cannot access Task Scheduler (non-admin) — admin creates tasks
- Project deployed at: `/volume1/Shared/nas-dedup/`
- Node.js v20 pre-installed on DSM

## Two Modes

- **scan.js** — standalone CLI, outputs HTML report. Run via Task Scheduler. No SSH needed.
- **server.js** — Express web UI on port 8080. Requires SSH or LAN to start. Interactive delete to `#recycle`.

## Language

- App UI (public/app.js, public/index.html, HTML in scan.js) stays in **Vietnamese**
- README and docs in **English**

## Git

- Author: Chuong <nvtc.98@gmail.com>
- GitHub: https://github.com/nvtc98/nas-dedup
