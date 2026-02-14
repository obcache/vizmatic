<?php
$versionFile = __DIR__ . '/dist/version.txt';
$version = null;

if (file_exists($versionFile)) {
  $version = trim(file_get_contents($versionFile));
}

$downloadFile = $version ? "vizmatic-setup-win64-{$version}.exe" : 'vizmatic-setup-win64-latest.exe';
$downloadUrl = "dist/{$downloadFile}";

$audioDir = __DIR__ . '/samples/audio';
$videoDir = __DIR__ . '/samples/video';
$samplesRoot = __DIR__ . '/samples';

$listFiles = static function (string $dir, string $ext): array {
  if (!is_dir($dir)) {
    return [];
  }
  $items = glob($dir . '/*.' . $ext);
  if (!$items) {
    return [];
  }
  natsort($items);
  return array_values($items);
};

$formatSize = static function (int $bytes): string {
  if ($bytes <= 0) {
    return '0 B';
  }
  $units = ['B', 'KB', 'MB', 'GB'];
  $power = (int) floor(log($bytes, 1024));
  $power = min($power, count($units) - 1);
  $value = $bytes / (1024 ** $power);
  return number_format($value, $power === 0 ? 0 : 1) . ' ' . $units[$power];
};

$audioFiles = $listFiles($audioDir, 'mp3');
$videoFiles = $listFiles($videoDir, 'mp4');

$pickExisting = static function (array $candidates): ?string {
  foreach ($candidates as $candidate) {
    if (is_file($candidate)) {
      return $candidate;
    }
  }
  return null;
};

$audioZip = $pickExisting([
  $samplesRoot . '/audio.zip',
  $samplesRoot . '/mp3.zip',
]);

$videoZip = $pickExisting([
  $samplesRoot . '/video.zip',
  $samplesRoot . '/mp4.zip',
]);
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vizmatic Samples</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="styles.css" />
    <link rel="icon" href="./assets/vizmatic_icon.png" />
  </head>
  <body>
    <header class="topbar">
      <div class="container topbar__inner">
        <a class="brand" href="index.php#home" aria-label="vizmatic homepage">
          <img src="assets/vizmatic_noText_logo.png" alt="" />
          <span>vizmatic</span>
        </a>
        <nav class="nav">
          <a href="index.php#home">Home</a>
          <a href="index.php#overview">Overview</a>
          <a href="index.php#usage">Usage</a>
          <a href="index.php#gallery">Gallery</a>
          <a href="samples.php">Samples</a>
          <a href="index.php#support">Support</a>
          <a class="btn-success btn-icon" href="<?php echo htmlspecialchars($downloadUrl, ENT_QUOTES, 'UTF-8'); ?>" download aria-label="Download">
            <span class="material-symbols-rounded" aria-hidden="true">download</span>
          </a>
          <a class="btn-primary btn-icon" href="index.php#purchase" aria-label="Purchase">
            <span class="material-symbols-rounded" aria-hidden="true">shopping_cart</span>
          </a>
        </nav>
      </div>
    </header>

    <main class="samples-page">
      <section class="info">
        <div class="container">
          <div class="info__head">
            <h2>Sample Downloads</h2>
            <p class="subhead">Audio loops, video loops, and bundled collections.</p>
          </div>

          <div class="samples-layout">
            <article class="card samples-block">
              <h3>Audio</h3>
              <?php if (!$audioFiles): ?>
                <p class="muted">No MP3 files found in <span class="code-inline">samples/audio</span>.</p>
              <?php else: ?>
                <div class="samples-audio-grid">
                  <?php foreach ($audioFiles as $filePath): ?>
                    <?php
                    $name = basename($filePath);
                    $rel = 'samples/audio/' . $name;
                    ?>
                    <article class="sample-audio-card" data-audio-player data-audio-src="<?php echo htmlspecialchars($rel, ENT_QUOTES, 'UTF-8'); ?>">
                      <div class="sample-audio-card__head">
                        <button type="button" class="sample-audio-card__play" data-audio-toggle aria-label="Play sample">
                          <span class="material-symbols-rounded" data-audio-icon aria-hidden="true">play_arrow</span>
                        </button>
                        <div class="sample-audio-card__meta">
                          <span class="sample-card__name"><?php echo htmlspecialchars($name, ENT_QUOTES, 'UTF-8'); ?></span>
                          <span class="sample-card__size muted"><?php echo htmlspecialchars($formatSize((int) filesize($filePath)), ENT_QUOTES, 'UTF-8'); ?></span>
                        </div>
                        <a class="sample-audio-card__download" href="<?php echo htmlspecialchars($rel, ENT_QUOTES, 'UTF-8'); ?>" download aria-label="Download audio sample">
                          <span class="material-symbols-rounded" aria-hidden="true">download</span>
                        </a>
                      </div>
                      <div class="sample-audio-card__wave" data-audio-wave></div>
                    </article>
                  <?php endforeach; ?>
                </div>
              <?php endif; ?>
            </article>

            <article class="card samples-block">
              <h3>Video</h3>
              <?php if (!$videoFiles): ?>
                <p class="muted">No MP4 files found in <span class="code-inline">samples/video</span>.</p>
              <?php else: ?>
                <div class="samples-grid">
                  <?php foreach ($videoFiles as $filePath): ?>
                    <?php
                    $name = basename($filePath);
                    $rel = 'samples/video/' . $name;
                    ?>
                    <a class="sample-card" href="<?php echo htmlspecialchars($rel, ENT_QUOTES, 'UTF-8'); ?>" download>
                      <div class="sample-card__thumb sample-card__thumb--video">
                        <span class="material-symbols-rounded sample-card__fallback" aria-hidden="true">movie</span>
                        <video src="<?php echo htmlspecialchars($rel, ENT_QUOTES, 'UTF-8'); ?>" muted preload="metadata" playsinline></video>
                      </div>
                      <div class="sample-card__meta">
                        <span class="sample-card__name"><?php echo htmlspecialchars($name, ENT_QUOTES, 'UTF-8'); ?></span>
                        <span class="sample-card__size muted"><?php echo htmlspecialchars($formatSize((int) filesize($filePath)), ENT_QUOTES, 'UTF-8'); ?></span>
                      </div>
                    </a>
                  <?php endforeach; ?>
                </div>
              <?php endif; ?>
            </article>

            <article class="card samples-block">
              <h3>Download Collection</h3>
              <div class="samples-grid samples-grid--collection">
                <?php if ($audioZip): ?>
                  <?php
                  $audioZipName = basename($audioZip);
                  $audioZipRel = 'samples/' . $audioZipName;
                  ?>
                  <a class="sample-card" href="<?php echo htmlspecialchars($audioZipRel, ENT_QUOTES, 'UTF-8'); ?>" download>
                    <div class="sample-card__thumb sample-card__thumb--collection">
                      <span class="material-symbols-rounded" aria-hidden="true">folder_zip</span>
                    </div>
                    <div class="sample-card__meta">
                      <span class="sample-card__name"><?php echo htmlspecialchars($audioZipName, ENT_QUOTES, 'UTF-8'); ?></span>
                      <span class="sample-card__size muted"><?php echo htmlspecialchars($formatSize((int) filesize($audioZip)), ENT_QUOTES, 'UTF-8'); ?></span>
                    </div>
                  </a>
                <?php else: ?>
                  <p class="muted">Missing <span class="code-inline">samples/audio.zip</span> or <span class="code-inline">samples/mp3.zip</span>.</p>
                <?php endif; ?>

                <?php if ($videoZip): ?>
                  <?php
                  $videoZipName = basename($videoZip);
                  $videoZipRel = 'samples/' . $videoZipName;
                  ?>
                  <a class="sample-card" href="<?php echo htmlspecialchars($videoZipRel, ENT_QUOTES, 'UTF-8'); ?>" download>
                    <div class="sample-card__thumb sample-card__thumb--collection">
                      <span class="material-symbols-rounded" aria-hidden="true">folder_zip</span>
                    </div>
                    <div class="sample-card__meta">
                      <span class="sample-card__name"><?php echo htmlspecialchars($videoZipName, ENT_QUOTES, 'UTF-8'); ?></span>
                      <span class="sample-card__size muted"><?php echo htmlspecialchars($formatSize((int) filesize($videoZip)), ENT_QUOTES, 'UTF-8'); ?></span>
                    </div>
                  </a>
                <?php else: ?>
                  <p class="muted">Missing <span class="code-inline">samples/video.zip</span> or <span class="code-inline">samples/mp4.zip</span>.</p>
                <?php endif; ?>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>
    <script src="https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js"></script>
    <script>
      (() => {
        const thumbs = document.querySelectorAll('.sample-card__thumb--video');
        thumbs.forEach((thumb) => {
          const video = thumb.querySelector('video');
          if (!video) return;

          const markReady = () => thumb.classList.add('is-ready');

          video.addEventListener('loadeddata', markReady, { once: true });
          video.addEventListener('error', () => thumb.classList.add('is-error'), { once: true });

          video.addEventListener('loadedmetadata', () => {
            if (video.duration && Number.isFinite(video.duration)) {
              const target = Math.min(0.15, Math.max(0, video.duration / 10));
              try {
                video.currentTime = target;
              } catch (err) {
                // Keep fallback icon if seeking is blocked.
              }
            }
          }, { once: true });
        });
      })();

      (() => {
        if (!window.WaveSurfer) {
          return;
        }
        const players = document.querySelectorAll('[data-audio-player]');
        players.forEach((player) => {
          const src = player.getAttribute('data-audio-src');
          const waveContainer = player.querySelector('[data-audio-wave]');
          const toggle = player.querySelector('[data-audio-toggle]');
          const icon = player.querySelector('[data-audio-icon]');

          if (!src || !waveContainer || !toggle || !icon) {
            return;
          }

          const ws = WaveSurfer.create({
            container: waveContainer,
            url: src,
            height: 64,
            waveColor: '#335188',
            progressColor: '#3c7cff',
            cursorColor: '#8ab1ff',
            barWidth: 2,
            barGap: 1,
            barRadius: 2,
          });

          const setIcon = (isPlaying) => {
            icon.textContent = isPlaying ? 'pause' : 'play_arrow';
          };

          toggle.addEventListener('click', () => {
            ws.playPause();
          });

          ws.on('play', () => setIcon(true));
          ws.on('pause', () => setIcon(false));
          ws.on('finish', () => setIcon(false));
        });
      })();
    </script>
  </body>
</html>
