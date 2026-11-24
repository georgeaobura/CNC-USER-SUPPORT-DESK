# User Support Tool (UST)

A responsive web application that can be installed on Android as a Progressive Web App (PWA). Uses the supplied organisation logo and ACMS blue (`#2E6DE7`). The supplied district/church workbook is imported into the initial database on first start.

## Included
- Request submission for ACMS, E-SADAKA and CNC DIGITAL ASSISTANT
- System-specific ticket IDs: `ACMS-YYYY-00001`, `ESADAKA-YYYY-00001`, `CNCDA-YYYY-00001`
- Separate yearly sequence for each system
- District -> dependent church selection
- Requester ticket tracking using ticket reference and submitted phone number
- Staff sign-in, ticket filtering, prioritisation, assignment, status and resolution notes
- District and church administration (add/deactivate; district rename; church deactivation)
- CSV report export and browser print view
- Basic PWA installability and cached application shell

## Requirements
- Node.js 20 or newer
- HTTPS for real-world hosting and Android installation (localhost is acceptable for local testing)

## Run locally
1. Extract this project folder.
2. Open a terminal in the folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Set a long random `JWT_SECRET`. Set `ADMIN_USERNAME=suadmins` and configure `ADMIN_PASSWORD` privately in your hosting environment (never commit `.env`). The requested initial password is short and should be replaced with a long, unique password before public deployment.
6. Run `npm start`.
7. Open `http://localhost:3000`.

The first run creates the administrator account from `ADMIN_USERNAME` and `ADMIN_PASSWORD` if the user table is empty. Alternatively, after the first start, create another administrator with `npm run create-admin`.

## Android installation
Deploy the app to a domain with HTTPS. Open the URL in Chrome on Android, choose **Install app** or **Add to Home screen**. It opens in an app-like standalone window. This is a PWA, not a Play Store APK.

## Initial district and church data
`data/districts.json` is generated from the supplied `DISTRCITS AND CHURCHES.xlsx`. On first server start, the 35 districts and 389 church records are inserted. Later edits are stored in SQLite and are not overwritten on restart.

## Important deployment and security notes
- This is a functional MVP starter, not yet a production-certified service.
- Put it behind HTTPS and a reverse proxy; set `NODE_ENV=production`.
- Replace the sample JWT secret and configure a strong, unique administrator password before public deployment. Do not store credentials in GitHub or commit `.env`.
- Back up `data/ust.sqlite` regularly and restrict access to the server filesystem.
- Configure proper SMTP/SMS gateways before promising outbound notifications. The current MVP supports requester status lookup; it does not yet send SMS or email automatically.
- Add a durable session/token revocation strategy, audit-log review, automated database backups, monitoring, and tested restore procedures before organisation-wide production use.
- Consider PostgreSQL and managed hosting if multiple offices will use it concurrently at scale.
- Never request or store a user's password, PIN or one-time code in a ticket.
