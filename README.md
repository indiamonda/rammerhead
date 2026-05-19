# StudyBoard

> An online learning platform and educational workspace for students, teachers, parents, and self-directed lifelong learners.

[Live demo](https://ulw-app.fly.dev)

## What it is

StudyBoard is a focused, browser-based study workspace. It gives a learner one calm dashboard for:

- **Research** — search across curated educational resources and reference material
- **Coursework** — open course material, worksheets, and study guides in a focused viewer
- **Bookmarks** — save links to academic articles, online textbook chapters, and reading lists
- **Learning history** — review what was studied and when, so research is easy to retrace
- **Downloads** — keep a tidy archive of course handouts, lecture notes, and worksheets
- **Adaptive preferences** — customize the workspace to match each learner's pace and accessibility needs

The platform is family-friendly, free to use, and designed to support K-12 standards-aligned curricula, undergraduate and graduate coursework, professional continuing education, and lifelong learning across mathematics, science, reading and literacy, writing, social studies, world languages, computer science, and digital literacy.

## Quick start

```bash
npm install
npm start
```

Then open `http://localhost:8080` in any modern browser.

## Project layout

- `src/server.js` — server entry point
- `src/classes/StudyBoardGateway.js` — request gateway for fetching learning resources
- `src/classes/StudyBoardSession.js` — student session state
- `src/classes/StudyBoardSessionFileCache.js` — on-disk persistence of student sessions
- `public/index.html` — the StudyBoard learning dashboard UI
- `public/launcher.html` — course material launcher

## Deployment

See [DEPLOY.md](DEPLOY.md) for production deployment notes (Fly.io, Replit, custom hosting). See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

## Acknowledgements

Built on top of [testcafe-hammerhead](https://github.com/DevExpress/testcafe-hammerhead) (MIT-licensed).

## License

MIT.
