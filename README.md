# Facebook Archive Viewer

A local, static web app for browsing a Facebook HTML export as a profile timeline. Archive files are processed in the browser and are not uploaded.

The interface defaults to Traditional Chinese (Taiwan). If the device's primary language is English, the interface switches to English automatically. Users can switch languages from the header at any time; their choice is saved on the device.

The interface uses short transitions for navigation, image browsing, and expanding details. Animations are disabled when the device requests reduced motion.

## Run locally

Use Node.js 17 or later.

```sh
npm install
npm run dev
```

Open `http://localhost:5173/`, then drag a Facebook ZIP export into the upload area or choose one manually. The format selector supports automatic detection or explicit selection of the Facebook HTML export schema.

## Build a static site

```sh
npm run build
```

Publish the contents of `dist/` to any static host. HTTPS is needed for service worker based offline use on a hosted site. After the first visit, the app shell can load offline; users choose the ZIP again each session because archive contents remain in memory only.

## Current scope

- Profile timeline with posts, photos, search, and a media viewer. The viewer supports on-screen and keyboard arrow navigation, with media-specific tags and descriptions in its information panel.
- Profile details, profile picture and cover photo, photo albums, videos, stories, reels, and Messenger conversations. Conversations display locally and load older messages in batches.
- Click a post to read its complete text, media, linked comments, and linked reactions in the Post Viewer. From an image, open the associated post when the archive contains an exact media file match; unmatched images do not link to a guessed post.
- Comments and reactions shown in the Activity view. They appear on a post only when both records contain a matching Facebook post identifier.
- ZIP files up to 500 MB compressed and 1 GB extracted. Larger exports need a streaming importer in a future release.
- Facebook HTML exports like the provided 2026 sample. JSON exports are not supported yet.

The provided sample contains profile information, photo albums, and Messenger conversations. Its live video, stories, and reels folders contain no content, so those views show empty states for this sample. Their HTML readers are ready for exports that contain entries, but those formats still need verification with representative files.

The sample's post pages contain 333 entries, while its comment and reaction pages do not supply matching identifiers for those posts. The viewer therefore keeps those interactions in the Activity view instead of assigning them to unrelated posts.

`References/` is ignored by Git because it may contain personal data.
