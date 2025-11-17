# Komiku Scraper

A robust and intelligent web scraper for collecting manga/comics metadata and page images. Automatically detects new chapters, resumes interrupted scrapes, and stores everything in a flexible database system (Supabase or local JSON).

**Perfect for:** Building comic archives, backup systems, or data collection pipelines.

---

## ✨ Features

### 🎯 Smart Chapter Detection
- **Automatic comparison** between API data and database to identify missing chapters
- **Resume capability**: If scraping is interrupted, the program automatically retries pending/failed chapters on next run
- **Numeric gap detection**: For series with numeric chapters (Ch. 1, 2, 3...), automatically detects and retries missing chapters
- **Duplicate prevention**: Idempotent operations ensure no duplicate data even with concurrent requests

### 📊 Comprehensive Metadata Scraping
- Extracts comic details: title, author, status (ongoing/completed), type (manga/manhwa), genres, synopsis
- Downloads and stores page images (URLs) for each chapter
- Tracks scraping status per chapter: `pending` → `scraped` / `failed`
- Records timestamps and error logs for debugging and monitoring

### 🔄 Flexible Database Support
- **Supabase** (optional): Full relational database with automatic schema management
- **Local JSON** (default): `./data/db.json` for offline-first development or simple deployments
- Seamless fallback: automatically uses local DB if Supabase credentials are missing
- Easy migration: Export local JSON data to Supabase anytime

### ⚡ Performance Optimized
- **Concurrency control**: Configurable item-level and chapter-level concurrency limits
- **Rate limiting**: Built-in delays between requests to avoid overwhelming target servers
- **Batch processing**: Efficiently handles paginated API responses
- **Retry logic**: Exponential backoff for failed requests with configurable max retries

### 📝 Detailed Logging
- Structured logging with Winston (logs stored in `./logs/`)
- Clear visibility into scraping progress: new chapters, retries, skipped chapters
- Error tracking and debugging information for failed requests

---

## 📋 Prerequisites

- **Node.js** >= 18
- **npm** or **yarn** for package management
- (Optional) **Supabase account** with a project created
- (Optional) Access to a comic API endpoint (e.g., `http://localhost:3000/api/komiku`)

---

## 🚀 Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd mixscrap-save
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your settings:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Comic API endpoint (required)
API_BASE=http://localhost:3000/api/komiku

# Supabase credentials (optional - leave empty to use local JSON)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here

# Performance tuning (optional)
CONCURRENCY=2                    # Parallel comics being processed
CHAPTER_CONCURRENCY=3            # Parallel chapters being scraped per comic
REQUEST_TIMEOUT_MS=45000         # HTTP request timeout
MAX_RETRIES=4                    # Max retry attempts for failed chapters
RETRY_BACKOFF_MS=2000            # Milliseconds between retries (increases exponentially)
```

### 3. Set Up Database (if using Supabase)

Run the SQL migration in your Supabase dashboard to create the required tables:

```sql
-- Enable pgcrypto extension
create extension if not exists "pgcrypto";

-- Comics table: stores comic metadata
create table if not exists public.comics (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  author text,
  status text,
  type text,
  param text not null unique,
  thumbnail text,
  genre text[],
  synopsis text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chapters table: stores chapter list and scraping status
create table if not exists public.chapters (
  id uuid default gen_random_uuid() primary key,
  comic_param text not null,
  chapter text,
  param text not null unique,
  release text,
  detail_url text,
  status text default 'pending',
  last_scraped_at timestamptz,
  last_error text,
  retries int default 0,
  created_at timestamptz default now(),
  foreign key (comic_param) references public.comics(param) on delete cascade
);

-- Pages table: stores chapter images
create table if not exists public.pages (
  id uuid default gen_random_uuid() primary key,
  chapter_param text not null unique,
  images text[],
  verified boolean default false,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  foreign key (chapter_param) references public.chapters(param) on delete cascade
);

-- Indexes for better performance
create index if not exists idx_comics_param on public.comics(param);
create index if not exists idx_chapters_param on public.chapters(param);
create index if not exists idx_chapters_status on public.chapters(status);
create index if not exists idx_pages_chapter_param on public.pages(chapter_param);
```

### 4. Run the Scraper

```bash
npm start
```

The scraper will:
1. Fetch the comic list from your API
2. For each comic:
   - Download metadata and chapter list
   - Compare with database to find new/missing chapters
   - Scrape pages for new and incomplete chapters
   - Update status in database
3. Display detailed progress logs in the terminal and save logs to `./logs/`

---

## 📊 Database Schema

### `comics` Table
Stores comic metadata.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `title` | TEXT | Comic title (required) |
| `author` | TEXT | Author name |
| `status` | TEXT | Status (e.g., "ongoing", "completed") |
| `type` | TEXT | Type (e.g., "manga", "manhwa") |
| `param` | TEXT | Unique identifier/slug (required, unique) |
| `thumbnail` | TEXT | Cover image URL |
| `genre` | TEXT[] | Array of genre tags |
| `synopsis` | TEXT | Plot description |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

### `chapters` Table
Stores chapter list and scraping metadata.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `comic_param` | TEXT | Foreign key to `comics.param` |
| `chapter` | TEXT | Chapter number/title |
| `param` | TEXT | Unique chapter identifier (unique) |
| `release` | TEXT | Release date |
| `detail_url` | TEXT | Source URL for scraping |
| `status` | TEXT | Scrape status: `pending`, `scraped`, `failed` |
| `last_scraped_at` | TIMESTAMPTZ | Last successful scrape time |
| `last_error` | TEXT | Error message from failed attempts |
| `retries` | INT | Retry counter |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

### `pages` Table
Stores chapter page images.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `chapter_param` | TEXT | Foreign key to `chapters.param` (unique) |
| `images` | TEXT[] | Array of image URLs |
| `verified` | BOOLEAN | Whether images have been verified |
| `last_verified_at` | TIMESTAMPTZ | Last verification time |
| `last_error` | TEXT | Verification error message |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

---

## 🔄 Workflow

### New Comic Detection
When the program starts:
1. Fetches comic list from API
2. For each comic, checks if it exists in the database
3. If new: inserts metadata and all chapter metadata, then begins scraping
4. If exists: compares API chapters with database chapters

### Chapter Processing
For each comic in the database:

```
API Chapters: [Ch-1, Ch-2, Ch-3, Ch-5, Ch-10]
DB Chapters:  [Ch-1, Ch-3, Ch-5, Ch-9]

Analysis:
├── NEW:        [Ch-2, Ch-10]          (in API, not in DB)
├── RETRY:      [Ch-9]                 (status != "scraped")
├── SKIP:       [Ch-1, Ch-3, Ch-5]     (already "scraped")
└── Scrape:     [Ch-2, Ch-9, Ch-10]    (total to scrape)
```

### Chapter Scraping
For each chapter marked for scraping:
1. Attempts to fetch pages from detail URL
2. Validates image URLs
3. Saves to database with status `pending`
4. On success: updates status to `scraped`, records timestamp
5. On failure: updates status to `failed`, logs error, retries up to `MAX_RETRIES` times

### Resume on Restart
If program is interrupted mid-scrape:
- Chapters with status `pending` or `failed` are automatically detected
- On next run, they are automatically retried
- Already `scraped` chapters are skipped
- No data duplication occurs

---

## 📁 Project Structure

```
mixscrap-save/
├── src/
│   ├── index.js                 # Entry point
│   ├── config.js                # Configuration from .env
│   ├── logger.js                # Winston logging setup
│   ├── http.js                  # Axios HTTP client
│   ├── utils.js                 # Utility functions
│   ├── db/
│   │   ├── index.js             # DB abstraction layer
│   │   ├── supabaseDb.js        # Supabase implementation
│   │   └── localDb.js           # Local JSON implementation
│   └── scraper/
│       ├── scraper.js           # Main orchestration logic
│       ├── listScraper.js       # Fetch comic list from API
│       ├── detailScraper.js     # Fetch comic metadata & chapters
│       └── chapterScraper.js    # Fetch chapter page images
├── data/
│   └── db.json                  # Local JSON database (auto-created)
├── logs/
│   └── *.log                    # Application logs
├── scripts/
│   ├── test_supabase.js         # Test Supabase connection
│   ├── check_db_exports.js      # Inspect local DB
│   └── test_update_chapter.js   # Test chapter updates
├── .env                         # Configuration (create from .env.example)
├── package.json
└── README.md
```

---

## ⚙️ Configuration Guide

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `http://localhost:3000/api/komiku` | Comic API endpoint URL |
| `CONCURRENCY` | `4` | Max parallel comics to process |
| `CHAPTER_CONCURRENCY` | `3` | Max parallel chapters per comic |
| `REQUEST_TIMEOUT_MS` | `15000` | HTTP request timeout (ms) |
| `SUPABASE_URL` | (empty) | Supabase project URL (optional) |
| `SUPABASE_KEY` | (empty) | Supabase anon key (optional) |
| `MAX_RETRIES` | `4` | Max retry attempts for failed chapters |
| `RETRY_BACKOFF_MS` | `2000` | Initial backoff delay (ms, increases exponentially) |

### Performance Tuning Tips

- **Increase `CONCURRENCY`**: Process more comics in parallel (use with caution - may overload API)
- **Increase `CHAPTER_CONCURRENCY`**: Fetch more chapter pages in parallel
- **Increase `REQUEST_TIMEOUT_MS`**: If getting timeout errors on slow connections
- **Adjust `MAX_RETRIES` and `RETRY_BACKOFF_MS`**: Balance between persistence and time

---

## 🧪 Testing & Debugging

### Test Supabase Connection
```bash
node scripts/test_supabase.js
```

### Inspect Local Database
```bash
node scripts/check_db_exports.js
```

### Test Chapter Status Update
```bash
node scripts/test_update_chapter.js
```

### View Logs
```bash
# Live logs
tail -f logs/app.log

# All logs
ls -la logs/
```

---

## 🛠️ Troubleshooting

### Issue: "Empty pages array for chapter"
**Cause**: The source website may have changed or the chapter doesn't exist.
**Solution**: Check the detail URL, verify it loads in a browser. Increase `REQUEST_TIMEOUT_MS`.

### Issue: "Local DB file not found"
**Cause**: First run hasn't created the data directory yet.
**Solution**: Create the directory manually: `mkdir -p data`, then run again. It will auto-create `db.json`.

### Issue: Chapters stuck in "pending" status
**Cause**: Scraping failed or was interrupted.
**Solution**: Run the program again - it will automatically retry pending chapters.

### Issue: "Duplicate chapter insert" warnings
**Cause**: Normal behavior - idempotent duplicate prevention.
**Solution**: No action needed; data integrity is maintained.

### Issue: Supabase connection fails
**Cause**: Invalid credentials or network issue.
**Solution**: 
- Verify `SUPABASE_URL` and `SUPABASE_KEY` in `.env`
- Check internet connection
- Test with: `node scripts/test_supabase.js`

---

## 📝 Example API Response Format

The scraper expects your API to return data in this format:

### List Endpoint: `/api/komiku`
```json
{
  "data": [
    {
      "param": "manga-slug-1",
      "title": "Manga Title 1",
      "detail_url": "http://source.com/manga/manga-slug-1",
      "next_page": "/api/komiku?page=2"
    },
    {
      "param": "manga-slug-2",
      "title": "Manga Title 2",
      "detail_url": "http://source.com/manga/manga-slug-2",
      "next_page": null
    }
  ],
  "next_page": "/api/komiku?page=2"
}
```

### Detail Endpoint (fetched from `detail_url`)
```json
{
  "data": {
    "param": "manga-slug-1",
    "title": "Manga Title 1",
    "author": "Author Name",
    "status": "ongoing",
    "type": "manga",
    "thumbnail": "http://source.com/image.jpg",
    "genre": ["Action", "Adventure", "Drama"],
    "synopsis": "Plot description...",
    "chapters": [
      {
        "param": "ch-1",
        "chapter": "1",
        "release": "2024-01-01",
        "detail_url": "http://source.com/manga/manga-slug-1/ch-1"
      },
      {
        "param": "ch-2",
        "chapter": "2",
        "release": "2024-01-08",
        "detail_url": "http://source.com/manga/manga-slug-1/ch-2"
      }
    ]
  }
}
```

### Chapter Pages Endpoint (fetched from chapter `detail_url`)
```json
{
  "data": [
    "http://source.com/images/page1.jpg",
    "http://source.com/images/page2.jpg",
    "http://source.com/images/page3.jpg"
  ]
}
```

---

## 📄 License

[Add your license here]

## 👤 Author

[Add author information here]

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

## 📚 Further Reading

- [Supabase Documentation](https://supabase.com/docs)
- [Winston Logger](https://github.com/winstonjs/winston)
- [p-limit](https://github.com/sindresorhus/p-limit)
- [Axios Documentation](https://axios-http.com/)
