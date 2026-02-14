<?php
$purchaseStatus = null;
$purchaseErrors = [];
$versionFile = __DIR__ . '/dist/version.txt';
$version = null;

if (file_exists($versionFile)) {
  $version = trim(file_get_contents($versionFile));
}

$downloadFile = $version ? "vizmatic-setup-win64-{$version}.exe" : 'vizmatic-setup-win64-latest.exe';
$downloadUrl = "dist/{$downloadFile}";
$downloadUrlAbsolute = "https://vizmatic.sorryneedboost.com/{$downloadUrl}";

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
  $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
  $rawBody = file_get_contents('php://input');
  $data = null;

  if (stripos($contentType, 'application/json') !== false) {
    $data = json_decode($rawBody, true);
  }

  if (!is_array($data)) {
    $data = $_POST;
  }

  $name = trim($data['name'] ?? '');
  $email = trim($data['email'] ?? '');
  $edition = trim($data['edition'] ?? '');
  $license = trim($data['license'] ?? '');

  if ($name === '' || $email === '' || $edition === '' || $license === '') {
    $purchaseErrors[] = 'Missing required fields.';
  }

  if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $purchaseErrors[] = 'Invalid email address.';
  }

  if ($edition !== '' && !in_array($edition, ['developer', 'perpetual'], true)) {
    $purchaseErrors[] = 'Invalid license edition.';
  }

  if (!$purchaseErrors) {
    $subject = 'vizmatic Activation Code';
    $message = "Hi {$name},\n\nYour activation code:\n\n{$license}\n\nDownload vizmatic:\n{$downloadUrlAbsolute}\n\nQuick start checklist:\n1) File > New Project\n2) Media > Load Audio...\n3) Media > Add Videos...\n4) Layers > Add Visualizer / Add Text\n5) File > Render\n\nPaste the activation code into vizmatic to activate.\n\nThanks,\nvizmatic";
    $headers = [
      'From: activation@sorryneedboost.com',
      'Reply-To: support@vizmatic.sorryneedboost.com',
      'Content-Type: text/plain; charset=UTF-8',
    ];

    $sent = mail($email, $subject, $message, [string]::Join("\r\n", $headers));
    if ($sent) {
      $purchaseStatus = 'Activation email sent.';
    } else {
      $purchaseErrors[] = 'Failed to send activation email.';
    }
  }

  $wantsJson = stripos($accept, 'application/json') !== false || stripos($contentType, 'application/json') !== false;
  if ($wantsJson) {
    http_response_code($purchaseErrors ? 400 : 200);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode([
      'ok' => !$purchaseErrors,
      'message' => $purchaseErrors ? $purchaseErrors[0] : ($purchaseStatus ?? 'Activation email sent.'),
    ]);
    exit;
  }
}
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vizmatic - visualize your vision</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="styles.css" />
    <link rel="icon" href="./assets/vizmatic_icon.png">
</head>
  <body>
    <header class="topbar">
      <div class="container topbar__inner">
        <a class="brand" href="https://vizmatic.sorryneedboost.com" aria-label="vizmatic homepage">
          <img src="assets/vizmatic_noText_logo.png" alt="" />
          <span>vizmatic</span>
        </a>
        <nav class="nav">
          <a href="#home">Home</a>
          <a href="#overview">Overview</a>
          <a href="#usage">Usage</a>
          <a href="#gallery">Gallery</a>
          <a href="samples.php">Samples</a>
          <a href="#support">Support</a>
          <a class="btn-success btn-icon" href="<?php echo htmlspecialchars($downloadUrl, ENT_QUOTES, 'UTF-8'); ?>" download aria-label="Download">
            <span class="material-symbols-rounded" aria-hidden="true">download</span>
          </a>
          <a class="btn-primary btn-icon" href="#purchase" aria-label="Purchase">
            <span class="material-symbols-rounded" aria-hidden="true">shopping_cart</span>
          </a>
        </nav>
      </div>
    </header>

    <main>
      <section class="hero" id="home">
        <div class="container hero__grid">
          <div class="hero__logo-panel">
            <img src="assets/vizmatic_slogan.png" alt="vizmatic slogan logo" />
          </div>

          <div class="hero__copy">
            <h1>Build cinematic music visualizers in minutes.</h1>

            <div class="hero__actions">
              <div class="action-stack">
                <a class="action-card action-card--download" href="<?php echo htmlspecialchars($downloadUrl, ENT_QUOTES, 'UTF-8'); ?>" download>
                  <span class="action-card__icon material-symbols-rounded" aria-hidden="true">download</span>
                  <span class="action-card__text">
                    <span class="action-card__label"><?php echo htmlspecialchars($downloadFile, ENT_QUOTES, 'UTF-8'); ?></span>
                    <span class="action-card__title">Download Free Trial</span>
                  </span>
                </a>
                <a class="action-card action-card--purchase" href="#purchase">
                  <span class="action-card__icon material-symbols-rounded" aria-hidden="true">shopping_cart</span>
                  <span class="action-card__text">
                    <span class="action-card__label">Unlock full version of Vizmatic</span>
                    <span class="action-card__title">Buy Perpetual License</span>
                  </span>
                </a>
              </div>
            </div>
          </div>

          <div class="hero__aside">
            <div class="card hero-card">
              <h2>At a Glance</h2>
              <p class="muted">Project-driven workflow with audio-first timelines and visualizer overlays.</p>
              <ul class="info-list">
                <li>Audio + video timeline assembly</li>
                <li>Spectrograph and text layers</li>
                <li>Landscape or portrait renders</li>
                <li>ffmpeg-backed rendering pipeline</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <section class="benefits benefits--top">
        <div class="container benefits__grid">
          <div class="benefit">
            <div class="benefit__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2l7 3v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <div class="benefit__title">Secure &amp; Encrypted</div>
            <div class="benefit__text">Industry-standard security protocols</div>
          </div>
          <div class="benefit">
            <div class="benefit__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
              </svg>
            </div>
            <div class="benefit__title">Instant Delivery</div>
            <div class="benefit__text">License keys delivered immediately</div>
          </div>
          <div class="benefit">
            <div class="benefit__icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12a8 8 0 1116 0 8 8 0 01-16 0z" />
                <path d="M7 12h4l2-2 4 0" />
              </svg>
            </div>
            <div class="benefit__title">Offline Verification</div>
            <div class="benefit__text">Works without internet connection</div>
          </div>
        </div>
      </section>
      <section class="info app-preview app-preview--plain">
        <div class="container">
          <div class="app-preview__grid" data-preview-grid>
            <div class="app-preview__shot">
              <button class="preview-toggle" type="button" aria-label="Fullscreen preview">
                <span class="material-symbols-rounded" aria-hidden="true">fullscreen</span>
              </button>
              <img src="assets/app-screenshot-1.png" alt="vizmatic interface showing timeline, layers, and preview" loading="lazy" />
            </div>
            <div class="app-preview__shot">
              <button class="preview-toggle" type="button" aria-label="Fullscreen preview">
                <span class="material-symbols-rounded" aria-hidden="true">fullscreen</span>
              </button>
              <img src="assets/app-screenshot-2.png" alt="vizmatic interface with media timeline and layer controls" loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      <section class="info" id="overview">
        <div class="container">
          <div class="info__head">
            <h2>Product Overview</h2>
            <p class="subhead">A streamlined toolset for building visualizer videos from start to finish.</p>
          </div>
          <div class="info__grid">
            <div class="card info-card">
              <h3>What vizmatic does</h3>
              <p class="muted">
                Assemble audio, video clips, spectrograph visualizers, and text layers into a final export using a project-based workflow.
              </p>
              <ul class="info-list">
                <li>Project save/load with JSON-based renders</li>
                <li>Audio + video timeline assembly</li>
                <li>Visualizer (spectrograph) and text overlays</li>
                <li>Render pipeline powered by ffmpeg</li>
              </ul>
            </div>
            <div class="card info-card">
              <h3>Project Basics</h3>
              <p class="muted">Save often. Rendering uses the saved project JSON.</p>
              <ul class="info-list">
                <li>Unsaved projects show: <span class="code-inline">vizmatic - Unsaved Project *</span></li>
                <li>Save: File &gt; Save</li>
                <li>Save As: File &gt; Save As...</li>
                <li>Open: File &gt; Open Project...</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="info" id="usage">
        <div class="container">
          <div class="info__head">
            <h2>Workflow Details</h2>
            <p class="subhead">From your first project to a polished render.</p>
          </div>
          <div class="workflow-grid">
            <div class="card info-card">
              <h3>Storyboard timeline</h3>
              <p class="muted">Reorder clips, trim for pacing, and loop short segments.</p>
              <ul class="info-list">
                <li>Drag clips to reorder</li>
                <li>Trim start/end with handles</li>
                <li>Loop clips by extending duration</li>
                <li>Context menu: rename, duplicate, remove</li>
              </ul>
            </div>
            <div class="card info-card">
              <h3>Layer controls</h3>
              <p class="muted">Keep text and visualizers editable throughout the edit.</p>
              <ul class="info-list">
                <li>Shared properties: color, outline, glow</li>
                <li>Position: X/Y %, rotate, transparency</li>
                <li>Spectrograph modes: bar, line, dots</li>
                <li>Text settings: content, font, size</li>
              </ul>
            </div>
            <div class="card info-card">
              <h3>Preview + orientation</h3>
              <p class="muted">Lock output sizes to your target format.</p>
              <ul class="info-list">
                <li>Landscape: 1920x1080</li>
                <li>Portrait: 1080x1920</li>
                <li>Clips stay centered to preserve aspect</li>
                <li>Zoom tools for long timelines</li>
              </ul>
            </div>
            <div class="card info-card">
              <h3>Render</h3>
              <p class="muted">Exports are driven by the saved project file.</p>
              <ul class="info-list">
                <li>Project &gt; Render or File &gt; Render</li>
                <li>Cancel anytime from Project or File menus</li>
                <li>Temporary render.json stored in .vizmatic</li>
                <li>Output file chosen at render start</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="info" id="gallery">
        <div class="container">
          <div class="info__head">
            <h2>Gallery</h2>
            <p class="subhead">Finished visualizers built with vizmatic.</p>
          </div>
          <div class="gallery__grid">
            <article class="gallery__item">
              <div class="gallery__thumb">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l11 7-11 7V5z" />
                </svg>
              </div>
              <h3>Neon Skyline</h3>
              <p class="muted">High-contrast bars with fast-paced cuts.</p>
            </article>
            <article class="gallery__item">
              <div class="gallery__thumb">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l11 7-11 7V5z" />
                </svg>
              </div>
              <h3>Moonlight Drift</h3>
              <p class="muted">Minimalist line spectrograph with soft glow.</p>
            </article>
            <article class="gallery__item">
              <div class="gallery__thumb">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l11 7-11 7V5z" />
                </svg>
              </div>
              <h3>Pulse Circuit</h3>
              <p class="muted">Layered bars and typography-driven captions.</p>
            </article>
            <article class="gallery__item">
              <div class="gallery__thumb">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l11 7-11 7V5z" />
                </svg>
              </div>
              <h3>Studio Echo</h3>
              <p class="muted">Portrait format visualizer for social reels.</p>
            </article>
            <article class="gallery__item">
              <div class="gallery__thumb">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l11 7-11 7V5z" />
                </svg>
              </div>
              <h3>Night Drive</h3>
              <p class="muted">Looped footage with slow-wave spectrum.</p>
            </article>
            <article class="gallery__item">
              <div class="gallery__thumb">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5l11 7-11 7V5z" />
                </svg>
              </div>
              <h3>Skywave</h3>
              <p class="muted">Full-screen spectrum with bold type overlays.</p>
            </article>
          </div>
        </div>
      </section>

      <section class="info" id="troubleshooting">
        <div class="container">
          <div class="info__head">
            <h2>Troubleshooting</h2>
            <p class="subhead">Fast fixes for the most common setup questions.</p>
          </div>
          <div class="info__grid">
            <div class="card info-card">
              <h3>Render fails with font errors</h3>
              <p class="muted">
                Ensure the font is in <span class="code-inline">client/public/fonts</span> and the font name matches the UI dropdown.
              </p>
            </div>
            <div class="card info-card">
              <h3>Spectrograph not visible</h3>
              <p class="muted">Verify audio is loaded and a spectrograph layer exists. Press Play once to initialize audio.</p>
            </div>
            <div class="card info-card">
              <h3>Missing media</h3>
              <p class="muted">If a file path is missing, the clip will highlight. Re-add the file or update the path.</p>
            </div>
          </div>
        </div>
      </section>

      <a name="Purchase"></a>
      <section class="purchase" id="purchase">
        <div class="container">
          <div class="purchase__grid">
            <div class="card purchase-card">
              <h2>Purchase License</h2>
              <p class="muted">Complete the form below to receive your license key</p>
              <form class="purchase-form" data-purchase-form method="post" action="">
                <label>
                  <span>Full Name</span>
                  <input type="text" name="name" placeholder="John Doe" required />
                </label>
                <label>
                  <span>Email Address</span>
                  <input type="email" name="email" placeholder="john@company.com" required />
                </label>
                <label>
                  <span>License Edition</span>
                  <select name="edition" required>
                    <option value="">Select an edition</option>
                    <option value="developer">Developer Edition (Partner Use Only)</option>
                    <option value="perpetual">Perpetual License | $99</option>
                  </select>
                </label>
                <label>
                  <span>Machine ID</span>
                  <div style="display:flex; gap:8px; align-items:center;">
                    <input type="text" name="machineIdDisplay" placeholder="Paste from app activation window" />
                    <button type="button" class="btn-secondary" data-paste-machine>Paste</button>
                  </div>
                  <div class="muted" data-machineid-status style="margin-top:6px;"></div>
                </label>
                <input type="hidden" name="machineId" value="" />
                <input type="hidden" name="license" value="" />
                <button class="btn-primary btn-wide" type="submit">
                  <span class="btn-lock">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 11V8a5 5 0 0110 0v3" />
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                    </svg>
                  </span>
                  Purchase
                </button>
                <p class="fineprint">Secure checkout | Instant delivery | 30-day money-back guarantee</p>
                <p class="purchase__status muted" data-purchase-status>
                  <?php echo htmlspecialchars($purchaseStatus ?? 'Developer Edition emails an activation key for testing.', ENT_QUOTES, 'UTF-8'); ?>
                </p>
                <p class="purchase__hint muted">Scroll down for activation steps.</p>
              </form>
            </div>
                      
            <div class="how how--embedded" id="how">
              <h2>How to Activate Your License <span class="anchor-cue">↓</span></h2>
              <p class="subhead">Follow these simple steps to activate your license after purchase</p>

              <div class="steps">
                <div class="step">
                  <div class="step__num">1</div>
                  <div>
                    <h3>Receive Your License Key</h3>
                    <p>After purchase, you will receive an email containing your unique license key. It will look like this:</p>
                    <div class="code-block">
                      eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiSm9obiBEb2UiLCJlbWFpbCI6ImpvaG5AY29tY...signature
                    </div>
                  </div>
                </div>
                <div class="step">
                  <div class="step__num">2</div>
                  <div>
                    <h3>Open the Application</h3>
                    <p>Launch your trial version of the application. You will see a license activation prompt.</p>
                  </div>
                </div>
                <div class="step">
                  <div class="step__num">3</div>
                  <div>
                    <h3>Paste Your License Key</h3>
                    <p>Copy the license key from your email and paste it into the activation modal. The application will verify it offline using the embedded public key.</p>
                  </div>
                </div>
                <div class="step">
                  <div class="step__num">4</div>
                  <div>
                    <h3>Start Using Full Version</h3>
                    <p>Once verified, all features will be unlocked immediately. No internet connection required for future use.</p>
                  </div>
                </div>
              </div>
            </div>
            <div class="purchase__aside">
              <img src="assets/vizmatic_setupWizard_logo.png" alt="vizmatic slogan logo" />
            </div>

          </div>
        </div>
      </section>
    </main>

    <section class="benefits benefits--bottom" id="support">
      <div class="container benefits__grid">
        <div class="benefit">
          <div class="benefit__icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2l7 3v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <div class="benefit__title">Secure &amp; Encrypted</div>
          <div class="benefit__text">Industry-standard security protocols</div>
        </div>
        <div class="benefit">
          <div class="benefit__icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
          </div>
          <div class="benefit__title">Instant Delivery</div>
          <div class="benefit__text">License keys delivered immediately</div>
        </div>
        <div class="benefit">
          <div class="benefit__icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12a8 8 0 1116 0 8 8 0 01-16 0z" />
              <path d="M7 12h4l2-2 4 0" />
            </svg>
          </div>
          <div class="benefit__title">Offline Verification</div>
          <div class="benefit__text">Works without internet connection</div>
        </div>
      </div>
    </section>

    <div class="modal" data-activation-modal hidden>
      <div class="modal__backdrop" data-modal-close></div>
      <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="activation-modal-title">
        <button class="modal__close" type="button" data-modal-close aria-label="Close">✕</button>
        <div class="modal__badge">Success</div>
        <h3 id="activation-modal-title">Congratulations on your purchase!</h3>
        <p class="muted">
          Your license key is below. Keep it safe, and paste it into vizmatic to activate.
        </p>
        <div class="code-block modal__code" data-license-display></div>
        <div class="modal__actions">
          <button class="btn-primary" type="button" data-copy-license>Copy to Clipboard</button>
          <span class="modal__copy-status muted" data-copy-status></span>
        </div>
        <p class="muted modal__note" data-email-note>Another copy will be emailed to you.</p>
      </div>
    </div>

    <footer class="footer">
      <div class="container footer__grid">
        <div class="footer__brand">
          <img src="assets/vizmatic_noText_logo.png" alt="" />
          <p>Secure offline license verification for proprietary applications.</p>
        </div>
        <div>
          <h4>Product</h4>
          <a href="#overview">Overview</a>
          <a href="#usage">Usage</a>
          <a href="#gallery">Gallery</a>
        </div>
        <div>
          <h4>Support</h4>
          <a href="#support">Support</a>
          <a href="#troubleshooting">Troubleshooting</a>
          <a href="#purchase">Contact Us</a>
        </div>
        <div>
          <h4>Legal</h4>
          <a href="#support">Privacy Policy</a>
          <a href="#support">Terms of Service</a>
          <a href="#support">Refund Policy</a>
        </div>
      </div>
      <div class="container footer__bottom">
        <span>vizmatic distribution portal. All rights reserved.</span>
        <span class="footer__secure">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2l7 3v6c0 5-3.5 9.4-7 11-3.5-1.6-7-6-7-11V5l7-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          Secured with industry-standard encryption
        </span>
      </div>
    </footer>

    <script src="js/portal.1d758320.js"></script>
  </body>
</html>
