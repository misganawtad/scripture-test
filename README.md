# Scripture Memory Test (English / Afaan Oromoo)

## Put it online (GitHub Pages)
1. Create a repository on GitHub and upload everything in this folder (keep the `data` folder).
2. Settings > Pages > "Deploy from a branch" > `main` / `(root)` > Save.
3. Your site opens at `https://YOUR-NAME.github.io/REPO-NAME/`.

You can also double-click `index.html` to try it on your own computer.

## Change a verse
Open the file for that language and set in the `data` folder:

| File | Contents |
|------|----------|
| `data/en-60.js`  | English, 60 verses |
| `data/en-242.js` | English, full set |
| `data/or-60.js`  | Afaan Oromoo, 60 verses |
| `data/or-242.js` | Afaan Oromoo, full set |

Each verse is one line:

    Title | Reference | Verse text

A line starting with `##` starts a new section:

    ## Prayer
    Prayer | John 15:7 | If you remain in me and my words remain in you...

- Edit a line to fix a verse. Add a line to add a verse. Delete a line to remove one.
- Do not use the `|` character inside a verse, and do not use the backtick character.
- The counts on the start page update by themselves.

## Change the words on the website
Open `strings.js`. English is under `en`, Afaan Oromoo under `or`.

## How marking works
- Capital letters, punctuation and apostrophes are ignored (unless "Strict marking" is ticked).
- Exception: names of God. If the verse writes a name of God with a capital letter (God, Lord, Jesus, Waaqayyo, Gooftaa, Yesus, Kristos...), the answer must use a capital letter too. The list of names is in `data/god-names.js`; add or remove names there, separated by commas.
- `John 3:16`, `John 3.16` and `Yohaannis 14፡21` / `14:21` are treated the same.
- When several verses share one title (for example "Christ the Center"), writing any of them is accepted.

## Sharing results
After submitting, the tester types their name and taps "Send on WhatsApp" (or Share / Copy message). The message contains the score and a link. When you open the link, you see the same score page with their answers and corrections. If the test was very long (for example all verses), the link carries scores only.
