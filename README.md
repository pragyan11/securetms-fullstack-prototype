# SecureTMS Prototype

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) 
[![Node.js](https://img.shields.io/badge/Node-18%2B-green.svg)](https://nodejs.org/) 
[![CI](https://github.com/pragyan11/securetms-fullstack-prototype/actions/workflows/ci.yml/badge.svg)](https://github.com/pragyan11/securetms-fullstack-prototype/actions/workflows/ci.yml)

> **Secure Transport Management System (SecureTMS)** – a full‑stack prototype demonstrating passwordless authentication (FIDO2/WebAuthn) and a modern operations dashboard for logistics.

## About

SecureTMS is a lightweight, full‑stack prototype that showcases passwordless authentication using WebAuthn/FIDO2 concepts, combined with a responsive logistics dashboard. It serves as a reference implementation for developers exploring modern authentication flows and basic transport management features.

## Releases

Current version: **1.0.0**

See the [Releases](https://github.com/pragyan11/securetms-fullstack-prototype/releases) page for changelog and future version updates.

---

## Table of Contents
1. [About](#about)
2. [Releases](#releases)
3. [Features](#features)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Running the Application](#running-the-application)
7. [Project Structure](#project-structure)
8. [API Overview](#api-overview)
9. [Contributing](#contributing)
10. [License](#license)
11. [Team / Contributors](#team--contributors)
12. [Demo / Live Preview](#demo--live-preview)
13. [Screenshots](#screenshots)
14. [Architecture Overview](#architecture-overview)
15. [Usage Walkthrough](#usage-walkthrough)
16. [Future Work / Roadmap](#future-work--roadmap)
17. [Acknowledgements](#acknowledgements)
18. [Contact / Support](#contact--support)

---

## Features
* **Passwordless authentication** using WebAuthn/FIDO2‑like flow.
* **Unified dashboard** with tabs for bookings, shipments, fleet, logs, and admin stats.
* **Modular pages** for bookings, shipments, fleet management, and user auth.
* **MongoDB** backend for persisting users, bookings, shipments, and fleet data.
* **Responsive UI** built with custom CSS (easy to swap for a UI framework).

---

## Prerequisites
* **Node.js** (v18 or later) – includes `npm`.
* **MongoDB 8.3** (or compatible) – running locally. The application now uses the connection string defined in `.env`:
   ```
   MONGO_URI=mongodb://127.0.0.1:27017/transitpass_tms
   ```
   Ensure the `transitpass_tms` database exists (it will be created automatically on first run).
* **Git** – for version control (already set up for this repo).

---

## Installation
```bash
git clone https://github.com/pragyan11/securetms-fullstack-prototype.git
cd securetms-fullstack-prototype
npm install
```

---

## Running the Application
1. **Start MongoDB** – ensure the service is running (e.g., `mongod` or via the provided `start_mongodb.bat`). The server expects MongoDB 8.3 but any compatible version works.
2. **Launch the server**:
   ```bash
   npm start   # runs `node server.js`
   ```
   The server will try to bind to port **4000**; if that port is already in use it automatically falls back to **4001** (as observed during testing).
3. Open your browser at the displayed URL, e.g. **http://127.0.0.1:4000** or **http://127.0.0.1:4001**.

The entry point is `public/index.html`. Use the navigation bar to explore the dashboard, bookings, fleet, and authentication pages.

---

## Project Structure
```
securetms_fullstack_prototype-real/
├─ server.js                # Express server configuration
├─ package.json             # npm dependencies & scripts
├─ public/                  # Static front‑end assets
│   ├─ index.html           # Home page / entry point
│   ├─ dashboard.html       # Operations dashboard
│   ├─ login.html           # Login page
│   ├─ register.html        # Registration page
│   └─ styles.css           # Custom styling (replaceable with a UI framework)
├─ routes/                  # Express route handlers (auth, bookings, fleet…)
├─ models/                  # Mongoose models (User, Booking, Fleet, …)
├─ middleware/              # Auth & role middleware
└─ scripts/                 # Utility scripts (e.g., clear_test_users.js)
```

---

## API Overview
The back‑end exposes a REST‑style API under `/api/*`. Key endpoints include:
* `POST /api/auth/register` – Register a new user.
* `POST /api/auth/login` – Authenticate and obtain a session token.
* `GET /api/bookings` – List bookings.
* `POST /api/bookings` – Create a new booking.
* `GET /api/fleet` – Retrieve fleet information.
* `GET /api/shipments` – List shipments.

Refer to the source files in the `routes/` directory for full details.

---

## Contributing
Contributions are welcome! Feel free to:
* Improve the UI (e.g., integrate Bootstrap or Tailwind).
* Add more comprehensive API validation.
* Write unit/integration tests.
* Enhance the authentication flow with real WebAuthn.

Please fork the repository, create a feature branch, and submit a pull request.

---

## License
This prototype is provided **as‑is** for educational purposes. See the `LICENSE` file for more information.

---

## Team / Contributors

| Name | Role | GitHub |
|------|------|--------|
| Pragyan | Project Lead / Backend | [pragyan11](https://github.com/pragyan11) |
| Member 2 | Front‑end UI | [123sumitra](https://github.com/123sumitra) |
| Member 3 | Database & Models | [eleem111](https://github.com/eleem111) |
| Member 4 | DevOps / CI | [swastikakarki-eng](https://github.com/swastikakarki-eng) |
| Member 5 | Documentation & Testing | [github.com/member5]((https://github.com/biplopbista0-crypto))|

## Demo / Live Preview

A live demo of the application is hosted at **[https://securetms-demo.example.com](https://securetms-demo.example.com)** (replace with your actual URL). The demo showcases the full login flow, dashboard navigation, and basic CRUD operations.

## Screenshots
> <img width="960" height="475" alt="image" src="https://github.com/user-attachments/assets/81694f81-1a2c-4d65-9375-5f5d118998cf" />
<img width="960" height="470" alt="image" src="https://github.com/user-attachments/assets/c53d5d4e-fdac-43f9-86d3-03a7c46e0f81" />

> <img width="955" height="467" alt="image" src="https://github.com/user-attachments/assets/80658825-f382-4ecd-878a-9af29cc3bf54" />
> <img width="959" height="476" alt="image" src="https://github.com/user-attachments/assets/a0ef6e7b-bb08-4235-8b55-7bd54841ffd9" />
> <img width="939" height="462" alt="image" src="https://github.com/user-attachments/assets/ac079960-8be0-4f57-a1a2-806201d1565f" />
> <img width="957" height="473" alt="image" src="https://github.com/user-attachments/assets/acbb9dd2-1004-44b2-8505-a5607655fc12" />

## Usage Walkthrough

1. **Register** a new user via the *Register* page.
2. **Login** using the passwordless WebAuthn flow.
3. **Create a booking** from the *Bookings* tab.
4. **View fleet status** on the *Fleet* tab.
5. **Logout** using the navigation bar.

## Future Work / Roadmap

- Implement real WebAuthn hardware support.
- Add role‑based dashboards (admin, manager, driver).
- Write unit and integration tests with Jest.
- Dockerize the application for easy deployment.
- Deploy CI pipeline to run linting and tests on every PR.

## Acknowledgements

This project uses the following open‑source libraries:

- `express` – Fast, unopinionated web framework.
- `mongoose` – Elegant MongoDB object modeling.
- `@simplewebauthn/browser` & `@simplewebauthn/server` – WebAuthn implementation.
- `dotenv` – Environment variable management.
- `helmet` – Security headers.

Special thanks to the **MDN Web Docs**, **Stack Overflow**, and our course mentors for guidance.

## Contact / Support

For questions, issues, or collaboration requests, please open an **[issue](https://github.com/pragyan11/securetms-fullstack-prototype/issues)** or contact the team via email at `securetms-capstone@example.com`.

