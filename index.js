const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const app = express();
const port = process.env.PORT || 3000;

// --- إعداد قاعدة البيانات ---
const db = new Database('movies.db');
db.pragma('journal_mode = WAL');

// إنشاء الجداول
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    release_year INTEGER,
    duration INTEGER,
    poster TEXT,
    video_url TEXT,
    trailer_url TEXT,
    meta_title TEXT,
    meta_description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS movie_category (
    movie_id INTEGER,
    category_id INTEGER,
    PRIMARY KEY (movie_id, category_id),
    FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    placement TEXT UNIQUE,
    ad_code TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE,
    content TEXT
  );
`);

// إدراج بعض الإعدادات الافتراضية إن لم تكن موجودة
const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertDefault.run('site_name', 'موقع الأفلام');
insertDefault.run('site_description', 'أفضل الأفلام الحصرية');
insertDefault.run('adsense_pub_id', 'pub-0000000000000000'); // استبدل بمعرفك

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public')); // لو عندك ملفات static (صور، CSS)

// --- Helper functions ---
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  return settings;
}

function getAd(placement) {
  const ad = db.prepare('SELECT ad_code FROM ads WHERE placement = ?').get(placement);
  return ad ? ad.ad_code : '';
}

function renderMovieSchema(movie) {
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Movie",
  "name": "${escapeHTML(movie.title)}",
  "image": "${escapeHTML(movie.poster || '')}",
  "dateCreated": "${movie.release_year || ''}",
  "description": "${escapeHTML(movie.meta_description || movie.description || '').substring(0, 150)}"
}
</script>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- المسارات العامة (الواجهة) ---

// الصفحة الرئيسية
app.get('/', (req, res) => {
  const settings = getSettings();
  const movies = db.prepare('SELECT * FROM movies ORDER BY created_at DESC LIMIT 12').all();
  const headerAd = getAd('header');
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${settings.site_name}</title>
  <meta name="description" content="${settings.site_description}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
  ${headerAd}
  <style> body { background-color: #0a0a0a; color: #fff; } .movie-card { transition: 0.3s; } .movie-card:hover { transform: scale(1.03); } </style>
</head>
<body>
  ${renderNavbar(settings)}
  <div class="container mt-4">
    <h1>أحدث الأفلام</h1>
    <div class="row">
      ${movies.map(m => `
      <div class="col-md-3 col-sm-6 mb-4">
        <div class="card bg-dark text-white movie-card">
          <a href="/movie/${m.slug}"><img src="${m.poster || 'https://via.placeholder.com/300x450'}" class="card-img-top" alt="${escapeHTML(m.title)}"></a>
          <div class="card-body">
            <h5 class="card-title"><a href="/movie/${m.slug}" class="text-white text-decoration-none">${escapeHTML(m.title)}</a></h5>
          </div>
        </div>
      </div>`).join('')}
    </div>
  </div>
  ${renderFooter(settings)}
</body>
</html>`);
});

// صفحة الفيلم
app.get('/movie/:slug', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE slug = ?').get(req.params.slug);
  if (!movie) return res.status(404).send('الفيلم غير موجود');
  const settings = getSettings();
  const inContentAd = getAd('in_content');
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${movie.meta_title || movie.title} - ${settings.site_name}</title>
  <meta name="description" content="${movie.meta_description || ''}">
  <meta property="og:title" content="${escapeHTML(movie.title)}">
  <meta property="og:image" content="${movie.poster}">
  ${renderMovieSchema(movie)}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
  <style> body { background-color: #0a0a0a; color: #fff; } video { max-height: 500px; } </style>
</head>
<body>
  ${renderNavbar(settings)}
  <div class="container mt-4">
    <div class="row">
      <div class="col-md-8">
        <h1>${escapeHTML(movie.title)}</h1>
        <video controls style="width:100%">
          <source src="${movie.video_url}" type="video/mp4">
          متصفحك لا يدعم تشغيل الفيديو.
        </video>
        <p class="mt-3">${movie.description || ''}</p>
        ${inContentAd ? `<div class="my-3">${inContentAd}</div>` : ''}
      </div>
      <div class="col-md-4">
        <img src="${movie.poster || 'https://via.placeholder.com/300x450'}" class="img-fluid rounded" alt="${escapeHTML(movie.title)}">
        ${movie.release_year ? `<p><strong>سنة الإصدار:</strong> ${movie.release_year}</p>` : ''}
        ${movie.duration ? `<p><strong>المدة:</strong> ${movie.duration} دقيقة</p>` : ''}
      </div>
    </div>
  </div>
  ${renderFooter(settings)}
</body>
</html>`);
});

// صفحة الفئة (اختياري)
app.get('/category/:slug', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return res.status(404).send('الفئة غير موجودة');
  const movies = db.prepare(`
    SELECT m.* FROM movies m
    JOIN movie_category mc ON m.id = mc.movie_id
    WHERE mc.category_id = ?
    ORDER BY m.created_at DESC
  `).all(category.id);
  const settings = getSettings();
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${category.name} - ${settings.site_name}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
  <style> body { background-color: #0a0a0a; color: #fff; } </style>
</head>
<body>
  ${renderNavbar(settings)}
  <div class="container mt-4">
    <h1>أفلام ${category.name}</h1>
    <div class="row">
      ${movies.map(m => `
      <div class="col-md-3 col-sm-6 mb-4">
        <div class="card bg-dark text-white">
          <a href="/movie/${m.slug}"><img src="${m.poster || 'https://via.placeholder.com/300x450'}" class="card-img-top" alt="${escapeHTML(m.title)}"></a>
          <div class="card-body">
            <h5 class="card-title"><a href="/movie/${m.slug}" class="text-white text-decoration-none">${escapeHTML(m.title)}</a></h5>
          </div>
        </div>
      </div>`).join('')}
    </div>
  </div>
  ${renderFooter(settings)}
</body>
</html>`);
});

// صفحات قانونية (سياسة الخصوصية، شروط الاستخدام)
app.get('/page/:slug', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug = ?').get(req.params.slug);
  if (!page) return res.status(404).send('الصفحة غير موجودة');
  const settings = getSettings();
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${page.title} - ${settings.site_name}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
  <style> body { background-color: #0a0a0a; color: #fff; } </style>
</head>
<body>
  ${renderNavbar(settings)}
  <div class="container mt-4">
    <h1>${page.title}</h1>
    <div>${page.content}</div>
  </div>
  ${renderFooter(settings)}
</body>
</html>`);
});

// Sitemap
app.get('/sitemap.xml', (req, res) => {
  const movies = db.prepare('SELECT slug, updated_at FROM movies').all();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${req.protocol}://${req.get('host')}</loc><changefreq>daily</changefreq></url>`;
  movies.forEach(m => {
    xml += `<url><loc>${req.protocol}://${req.get('host')}/movie/${m.slug}</loc><lastmod>${new Date(m.updated_at).toISOString()}</lastmod></url>`;
  });
  xml += '</urlset>';
  res.header('Content-Type', 'application/xml');
  res.send(xml);
});

// Ads.txt
app.get('/ads.txt', (req, res) => {
  const pubId = getSettings().adsense_pub_id || 'pub-0000000000000000';
  res.send(`google.com, ${pubId}, DIRECT, f08c47fec0942fa0`);
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Sitemap: ${req.protocol}://${req.get('host')}/sitemap.xml`);
});

// --- لوحة الإدارة ---

// صفحة تسجيل الدخول بسيطة (بدون باسورد) للعرض فقط، يمكنك تعزيزها لاحقاً
app.get('/admin', (req, res) => {
  // في بيئة حقيقية تحتاج إلى نظام مصادقة، هنا سنعرض لوحة تحكم بسيطة بدون حماية كمثال
  res.redirect('/admin/dashboard');
});

app.get('/admin/dashboard', (req, res) => {
  const moviesCount = db.prepare('SELECT COUNT(*) as count FROM movies').get().count;
  const adsCount = db.prepare('SELECT COUNT(*) as count FROM ads').get().count;
  res.send(renderAdminPage('لوحة التحكم', `
    <h1 class="mb-4">لوحة التحكم</h1>
    <div class="row">
      <div class="col-md-4">
        <div class="card text-white bg-primary mb-3">
          <div class="card-body">
            <h5 class="card-title">الأفلام</h5>
            <p class="card-text display-4">${moviesCount}</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card text-white bg-success mb-3">
          <div class="card-body">
            <h5 class="card-title">الإعلانات</h5>
            <p class="card-text display-4">${adsCount}</p>
          </div>
        </div>
      </div>
    </div>
    <a href="/admin/movies" class="btn btn-light">إدارة الأفلام</a>
    <a href="/admin/ads" class="btn btn-light">إدارة الإعلانات</a>
    <a href="/admin/settings" class="btn btn-light">الإعدادات</a>
    <a href="/admin/pages" class="btn btn-light">الصفحات</a>
  `));
});

// إدارة الأفلام في لوحة التحكم
app.get('/admin/movies', (req, res) => {
  const movies = db.prepare('SELECT * FROM movies ORDER BY created_at DESC').all();
  res.send(renderAdminPage('إدارة الأفلام', `
    <h1>إدارة الأفلام</h1>
    <a href="/admin/movies/new" class="btn btn-success mb-3">إضافة فيلم جديد</a>
    <table class="table table-dark table-striped">
      <thead><tr><th>العنوان</th><th>تاريخ الإضافة</th><th>إجراءات</th></tr></thead>
      <tbody>
        ${movies.map(m => `
        <tr>
          <td>${escapeHTML(m.title)}</td>
          <td>${m.created_at}</td>
          <td>
            <a href="/admin/movies/edit/${m.id}" class="btn btn-sm btn-warning">تعديل</a>
            <a href="/admin/movies/delete/${m.id}" class="btn btn-sm btn-danger" onclick="return confirm('متأكد؟')">حذف</a>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    <a href="/admin/dashboard" class="btn btn-secondary">العودة للوحة التحكم</a>
  `));
});

// صفحة إضافة فيلم
app.get('/admin/movies/new', (req, res) => {
  res.send(renderAdminPage('إضافة فيلم', `
    <h1>إضافة فيلم جديد</h1>
    <form action="/admin/movies" method="POST">
      <div class="mb-3"><label>العنوان</label><input class="form-control" name="title" required></div>
      <div class="mb-3"><label>الرابط المختصر (slug)</label><input class="form-control" name="slug" required></div>
      <div class="mb-3"><label>الوصف</label><textarea class="form-control" name="description"></textarea></div>
      <div class="mb-3"><label>سنة الإصدار</label><input class="form-control" name="release_year" type="number"></div>
      <div class="mb-3"><label>المدة (دقائق)</label><input class="form-control" name="duration" type="number"></div>
      <div class="mb-3"><label>رابط البوستر</label><input class="form-control" name="poster"></div>
      <div class="mb-3"><label>رابط الفيديو</label><input class="form-control" name="video_url" required></div>
      <div class="mb-3"><label>Meta Title</label><input class="form-control" name="meta_title"></div>
      <div class="mb-3"><label>Meta Description</label><textarea class="form-control" name="meta_description"></textarea></div>
      <button type="submit" class="btn btn-primary">حفظ</button>
    </form>
    <a href="/admin/movies" class="btn btn-secondary mt-2">العودة</a>
  `));
});

app.post('/admin/movies', (req, res) => {
  const { title, slug, description, release_year, duration, poster, video_url, trailer_url, meta_title, meta_description } = req.body;
  db.prepare(`INSERT INTO movies (title, slug, description, release_year, duration, poster, video_url, trailer_url, meta_title, meta_description)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title, slug, description, release_year, duration, poster, video_url, trailer_url, meta_title, meta_description);
  res.redirect('/admin/movies');
});

// تعديل فيلم (GET)
app.get('/admin/movies/edit/:id', (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) return res.status(404).send('غير موجود');
  res.send(renderAdminPage('تعديل فيلم', `
    <h1>تعديل الفيلم</h1>
    <form action="/admin/movies/edit/${movie.id}" method="POST">
      <input type="hidden" name="_method" value="PUT">
      <div class="mb-3"><label>العنوان</label><input class="form-control" name="title" value="${escapeHTML(movie.title)}" required></div>
      <div class="mb-3"><label>الرابط المختصر</label><input class="form-control" name="slug" value="${escapeHTML(movie.slug)}" required></div>
      <div class="mb-3"><label>الوصف</label><textarea class="form-control" name="description">${escapeHTML(movie.description || '')}</textarea></div>
      <div class="mb-3"><label>سنة الإصدار</label><input class="form-control" name="release_year" type="number" value="${movie.release_year || ''}"></div>
      <div class="mb-3"><label>المدة</label><input class="form-control" name="duration" type="number" value="${movie.duration || ''}"></div>
      <div class="mb-3"><label>رابط البوستر</label><input class="form-control" name="poster" value="${escapeHTML(movie.poster || '')}"></div>
      <div class="mb-3"><label>رابط الفيديو</label><input class="form-control" name="video_url" value="${escapeHTML(movie.video_url)}" required></div>
      <div class="mb-3"><label>Meta Title</label><input class="form-control" name="meta_title" value="${escapeHTML(movie.meta_title || '')}"></div>
      <div class="mb-3"><label>Meta Description</label><textarea class="form-control" name="meta_description">${escapeHTML(movie.meta_description || '')}</textarea></div>
      <button type="submit" class="btn btn-primary">تحديث</button>
    </form>
    <a href="/admin/movies" class="btn btn-secondary mt-2">العودة</a>
  `));
});

// تحديث الفيلم
app.put('/admin/movies/edit/:id', (req, res) => {
  const { title, slug, description, release_year, duration, poster, video_url, trailer_url, meta_title, meta_description } = req.body;
  db.prepare(`UPDATE movies SET title=?, slug=?, description=?, release_year=?, duration=?, poster=?, video_url=?, trailer_url=?, meta_title=?, meta_description=? WHERE id=?`)
    .run(title, slug, description, release_year, duration, poster, video_url, trailer_url, meta_title, meta_description, req.params.id);
  res.redirect('/admin/movies');
});

// حذف فيلم
app.get('/admin/movies/delete/:id', (req, res) => {
  db.prepare('DELETE FROM movies WHERE id = ?').run(req.params.id);
  res.redirect('/admin/movies');
});

// إدارة الإعلانات (مبسطة)
app.get('/admin/ads', (req, res) => {
  const ads = db.prepare('SELECT * FROM ads').all();
  res.send(renderAdminPage('إدارة الإعلانات', `
    <h1>إدارة الإعلانات</h1>
    <a href="/admin/ads/new" class="btn btn-success mb-3">إضافة إعلان جديد</a>
    <table class="table table-dark">
      <tr><th>المكان</th><th>الكود</th><th>إجراءات</th></tr>
      ${ads.map(a => `
      <tr>
        <td>${a.placement}</td>
        <td><textarea rows="3" class="form-control" readonly>${escapeHTML(a.ad_code)}</textarea></td>
        <td>
          <a href="/admin/ads/edit/${a.id}" class="btn btn-warning btn-sm">تعديل</a>
          <a href="/admin/ads/delete/${a.id}" class="btn btn-danger btn-sm">حذف</a>
        </td>
      </tr>`).join('')}
    </table>
    <a href="/admin/dashboard">رجوع</a>
  `));
});

// باقي عمليات الإعلانات...
// وبالمثل للصفحات والإعدادات، يمكنني إكمالها إذا أردت.

// --- دوال مساعدة للـ HTML المشترك ---
function renderNavbar(settings) {
  return `<nav class="navbar navbar-expand-lg navbar-dark bg-dark">
  <div class="container">
    <a class="navbar-brand" href="/">${settings.site_name}</a>
    <div class="collapse navbar-collapse">
      <ul class="navbar-nav ms-auto">
        <li class="nav-item"><a class="nav-link" href="/">الرئيسية</a></li>
        <li class="nav-item"><a class="nav-link" href="/page/privacy-policy">سياسة الخصوصية</a></li>
        <li class="nav-item"><a class="nav-link" href="/page/terms-conditions">شروط الاستخدام</a></li>
      </ul>
    </div>
  </div>
</nav>`;
}

function renderFooter(settings) {
  return `<footer class="bg-dark text-center text-white mt-5 p-3">
  <p>© ${new Date().getFullYear()} ${settings.site_name}. جميع الحقوق محفوظة.</p>
  <p><a href="/page/privacy-policy" class="text-white">سياسة الخصوصية</a> | <a href="/page/terms-conditions" class="text-white">شروط الاستخدام</a></p>
</footer>`;
}

function renderAdminPage(title, content) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>${title} | لوحة الإدارة</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css" rel="stylesheet">
  <style> body { background-color: #121212; color: #fff; } .container { margin-top: 30px; } </style>
</head>
<body>
  <nav class="navbar navbar-dark bg-dark"><div class="container"><a class="navbar-brand" href="/admin/dashboard">لوحة التحكم</a></div></nav>
  <div class="container">${content}</div>
</body>
</html>`;
}

// بدء الخادم
app.listen(port, () => {
  console.log(`الموقع شغال على http://localhost:${port}`);
  console.log(`لوحة الإدارة: http://localhost:${port}/admin/dashboard`);
});
