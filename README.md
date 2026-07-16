# SecureTMS Prototype

> **Secure Transport Management System (SecureTMS)** – a full‑stack prototype demonstrating passwordless authentication (FIDO2/WebAuthn) and a modern operations dashboard for logistics.

---

## Table of Contents
1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Running the Application](#running-the-application)
5. [Project Structure](#project-structure)
6. [API Overview](#api-overview)
7. [Contributing](#contributing)
8. [License](#license)

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
* **MongoDB** – running locally (default connection string `mongodb://localhost:27017/securetms`).
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
1. **Start MongoDB** – ensure the service is running (e.g., `mongod` or via the provided `start_mongodb.bat`).
2. **Launch the server**:
   ```bash
   npm start   # runs `node server.js`
   ```
3. Open your browser at **http://127.0.0.1:4000**.

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

*Happy hacking!*