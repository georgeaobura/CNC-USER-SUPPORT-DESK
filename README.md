# CNC User Support Desk

Responsive ICT support ticketing web application for Central Nyanza Conference (CNC).

## Project package
The recovered implementation is being added to this repository. It is a Node.js 20+ application using Express and SQLite, with a browser-based staff console and an Android-installable Progressive Web App (PWA).

## Features
- Ticket submission for ACMS, E-SADAKA and CNC Digital Assistant
- System-specific ticket references and yearly sequences
- Dependent district and church selection (35 districts / 389 churches)
- Requester ticket tracking
- Staff/admin authentication and user management
- Ticket assignment, prioritisation, status and resolution notes
- District/church administration and CSV reports
- PWA manifest and service worker

## Local setup
1. Install Node.js 20 or newer.
2. Extract the application source package into a working folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Set a long random `JWT_SECRET`.
6. Set `ADMIN_USERNAME=suadmins` and set `ADMIN_PASSWORD` privately in your local `.env` or hosting provider's environment secrets.
7. Run `npm start` and open `http://localhost:3000`.

The first application start creates the initial administrator only when the users table is empty. The password is stored as a bcrypt hash in SQLite. Never commit `.env`, database files, real credentials, or backups to GitHub.

## Administrator credential note
The requested username is `suadmins`. The requested initial password, `Admins`, is only six characters and is not suitable for a publicly deployed administrator account. The current manual admin-creation script requires at least 12 characters. Use a long, unique password in the deployment environment before exposing the service to the internet, and rotate any temporary credential immediately.

## Deployment
Deploy behind HTTPS, configure `NODE_ENV=production`, provide a strong private `JWT_SECRET`, and persist the SQLite data directory. Back up the database securely. Do not rely on the SQLite file being stored on an ephemeral hosting filesystem.

## Security
- Keep `.env` and `data/ust.sqlite*` out of version control.
- Use HTTPS and a strong unique administrator password.
- Back up and restrict access to the SQLite database.
- Configure SMTP/SMS providers only after their credentials are stored as private environment secrets.
- This is an MVP starter and should receive deployment hardening, monitoring, backups and restore testing before organisation-wide production use.
