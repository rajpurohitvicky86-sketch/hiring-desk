# Hiring Desk

A 15-minute basic computer skills test for candidates, with a PIN-protected HR area for scoring.
Candidate answers and HR scores are saved in Netlify Blobs (Netlify's built-in storage), so the
site works from any phone or computer.

## What is in this folder

- `public/index.html` – the website (candidate side and HR side)
- `netlify/functions/api.mjs` – the server: saves candidates, marks the quiz and typing, checks the HR PIN
- `netlify.toml`, `package.json` – settings Netlify reads when it builds the site

## Put it online (one time, about 15 minutes)

1. **GitHub:** sign up at github.com. Click **New repository**, name it `hiring-desk`, choose **Private**, and click **Create repository**.
2. On the new repository page, click **uploading an existing file**. Drag in everything inside this folder (`public`, `netlify`, `netlify.toml`, `package.json`, `README.md`) and click **Commit changes**.
3. **Netlify:** sign up at netlify.com using **Sign up with GitHub**.
4. Click **Add new site** > **Import an existing project** > **GitHub**, and pick `hiring-desk`. Leave the build settings as they are and click **Deploy**.
5. Set your HR PIN: open the site in Netlify > **Site configuration** > **Environment variables** > **Add a variable**. Key: `HR_PIN`. Value: your PIN (use 6 or more digits).
6. Go to **Deploys** > **Trigger deploy** > **Deploy site** so the PIN takes effect.
7. Optional: **Site configuration** > **Change site name** to get a link like `https://yourshop-hiring.netlify.app`.

Netlify may rename some menus over time; the names above match its dashboard as of late 2026.

## First use

1. Open your link and tap **Open HR area**. Enter your PIN.
2. In **Settings**, enter the email address candidates should send the Excel file to (Task 3).
3. Do one practice test yourself as a candidate, then score it in the HR area.

## Changing the test later

Questions are in `public/index.html` (the `QUIZ` list). The correct answers are in
`netlify/functions/api.mjs` (`QUIZ_KEY`), so candidates cannot see them. If you change a question,
change both files, then upload them to GitHub again. Netlify updates the site automatically.
