# Contributing to SecureTMS Prototype

We welcome contributions! Follow these steps to get started:

1. **Fork the repository** and clone your fork.
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** – ensure code follows existing style and passes linting.
4. **Run tests (if any)** and lint:
   ```bash
   npm install
   npm run lint   # if a lint script is defined
   ```
5. **Commit your changes** with a clear message.
6. **Push to your fork** and open a Pull Request against `main`.

### Pull Request Guidelines
- Provide a concise description of what the PR does.
- Reference any related issues using `#issue-number`.
- Ensure the PR passes CI (GitHub Actions) before merging.
- Keep commits focused; squash if necessary.

### Code Style
- Use 2‑space indentation.
- Prefer `const`/`let` over `var`.
- Follow existing naming conventions.
- Add or update documentation in the README when appropriate.

Thank you for helping make SecureTMS better!