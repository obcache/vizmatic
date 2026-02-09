(() => {
  const form = document.querySelector('[data-purchase-form]');
  const status = document.querySelector('[data-purchase-status]');
  const modal = document.querySelector('[data-activation-modal]');
  const licenseDisplay = modal ? modal.querySelector('[data-license-display]') : null;
  const copyButton = modal ? modal.querySelector('[data-copy-license]') : null;
  const copyStatus = modal ? modal.querySelector('[data-copy-status]') : null;
  const emailNote = modal ? modal.querySelector('[data-email-note]') : null;
  const modalCloseTargets = modal ? modal.querySelectorAll('[data-modal-close]') : [];
  const previewGrid = document.querySelector('[data-preview-grid]');

  if (!form || !status) {
    return;
  }

  let activeLicense = '';
  let bodyOverflow = '';

  const setStatus = (message) => {
    status.textContent = message;
  };

  const showModal = (license, email, emailMessage) => {
    if (!modal || !licenseDisplay) {
      return;
    }

    activeLicense = license;
    licenseDisplay.textContent = license;
    if (copyStatus) {
      copyStatus.textContent = '';
    }
    if (emailNote) {
      if (email) {
        emailNote.textContent = `Another copy will be emailed to ${email}.`;
      } else {
        emailNote.textContent = 'Another copy will be emailed to you.';
      }
      if (emailMessage) {
        emailNote.textContent = `${emailNote.textContent} ${emailMessage}`;
      }
    }

    modal.hidden = false;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  };

  const closeModal = () => {
    if (!modal) {
      return;
    }
    modal.hidden = true;
    document.body.style.overflow = bodyOverflow;
  };

  const copyLicense = async () => {
    if (!activeLicense) {
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(activeLicense);
      } else {
        const temp = document.createElement('textarea');
        temp.value = activeLicense;
        temp.style.position = 'fixed';
        temp.style.top = '-1000px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }
      if (copyStatus) {
        copyStatus.textContent = 'Copied!';
      }
    } catch (error) {
      if (copyStatus) {
        copyStatus.textContent = 'Copy failed. Please select and copy manually.';
      }
    }
  };

  if (copyButton) {
    copyButton.addEventListener('click', copyLicense);
  }

  if (modalCloseTargets.length) {
    modalCloseTargets.forEach((button) => {
      button.addEventListener('click', closeModal);
    });
  }

  const togglePreview = (shot, force) => {
    if (!shot) return;
    const isActive = shot.classList.contains('is-fullscreen');
    const nextState = force !== undefined ? force : !isActive;
    if (nextState) {
      shot.classList.add('is-fullscreen');
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      shot.classList.remove('is-fullscreen');
      document.body.style.overflow = bodyOverflow;
    }
  };

  if (previewGrid) {
    previewGrid.addEventListener('click', (event) => {
      const button = event.target.closest('.preview-toggle');
      if (button) {
        const shot = button.closest('.app-preview__shot');
        togglePreview(shot);
        return;
      }
      const fullscreenShot = event.target.closest('.app-preview__shot.is-fullscreen');
      if (fullscreenShot) {
        togglePreview(fullscreenShot, false);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && previewGrid) {
      const activeShot = previewGrid.querySelector('.app-preview__shot.is-fullscreen');
      if (activeShot) {
        togglePreview(activeShot, false);
        return;
      }
    }
    if (event.key === 'Escape' && modal && !modal.hidden) {
      closeModal();
    }
  });

  const base64Url = (input) => {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer ?? input);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const buildPayload = (data, machineIdOverride) => ({
    name: data.get('name'),
    email: data.get('email'),
    edition: data.get('edition'),
    machineId: machineIdOverride || data.get('machineId') || null,
    issuedAt: Date.now(),
    expiresAt: null,
  });

  const generateLicenseWithPrivateKey = async (payload) => {
    const response = await fetch('assets/.cache/kdat.5c9f2.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to load license keypair.');
    }

    const keyFile = await response.json();
    const privateJwk = keyFile.privateJwk || keyFile;

    if (!privateJwk.d) {
      throw new Error('Private key material missing.');
    }

    const key = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const payloadString = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(payloadString);
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, payloadBytes);

    return `${base64Url(payloadBytes)}.${base64Url(signature)}`;
  };

  const sendEmailWithServer = async (payload, license) => {
    const action = form.getAttribute('action') || window.location.pathname || 'index.php';
    const response = await fetch(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        name: payload.name,
        email: payload.email,
        edition: payload.edition,
        license,
      }),
    });

    let message = 'Failed to send activation email.';
    try {
      const data = await response.json();
      if (data && data.message) {
        message = data.message;
      }
    } catch (error) {
      // Ignore JSON parse errors for non-JSON responses.
    }

    if (!response.ok) {
      throw new Error(message);
    }

    return message;
  };


  const machineIdInput = form.querySelector('input[name="machineId"]');
  const machineIdDisplay = form.querySelector('input[name="machineIdDisplay"]');
  const machineIdStatus = form.querySelector('[data-machineid-status]');
  const pasteMachineBtn = form.querySelector('[data-paste-machine]');
  if (machineIdInput) {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const machineId = params.get('machineId');
      if (machineId) {
        machineIdInput.value = machineId;
        if (machineIdDisplay) {
          machineIdDisplay.value = machineId;
        }
      }
    } catch (error) {
      // ignore bad query string
    }
  }

  const syncMachineId = () => {
    if (machineIdInput && machineIdDisplay && machineIdDisplay.value) {
      machineIdInput.value = machineIdDisplay.value.trim();
    }
    if (machineIdStatus) {
      const value = (machineIdDisplay ? machineIdDisplay.value : '') || '';
      const ok = /^[a-f0-9]{32,128}$/i.test(value.trim());
      machineIdStatus.textContent = ok ? 'Machine ID validated' : 'This is not a valid Machine ID';
      machineIdStatus.style.color = ok ? '#22c55e' : '#ef4444';
    }
  };

  if (machineIdDisplay) {
    machineIdDisplay.addEventListener('input', syncMachineId);
    machineIdDisplay.addEventListener('blur', syncMachineId);
  }
  if (pasteMachineBtn && navigator.clipboard && navigator.clipboard.readText) {
    pasteMachineBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (machineIdDisplay) {
          machineIdDisplay.value = text.trim();
        }
        syncMachineId();
      } catch (error) {
        setStatus('Clipboard access denied. Paste manually.');
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    syncMachineId();
    const formData = new FormData(form);
    const edition = formData.get('edition');
    const name = formData.get('name');
    const machineId = String(formData.get('machineId') || (machineIdDisplay ? machineIdDisplay.value : '') || '').trim();

    if (!machineId) {
      setStatus('Machine ID missing. Please open this page from the app activation link.');
      return;
    }

    if (edition !== 'developer') {
      setStatus('Payment processing is not enabled yet. Use Developer Edition for testing.');
      return;
    }

    if (name !== 'Sorry NeedVizmatic') {
      setStatus('Not Authorized for Development Copy. If you feel this is in error, please contact vizmatic support at support@vizmatic.sorryneedboost.com');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
    }

    setStatus('Generating activation code...');

    const payload = buildPayload(formData, machineId);

    try {
      if (window.vizmaticLicensing && typeof window.vizmaticLicensing.generateAndEmail === 'function') {
        const result = await window.vizmaticLicensing.generateAndEmail(payload);
        const message = 'Activation email sent.';
        setStatus(message);
        if (typeof result === 'string') {
          showModal(result, payload.email, message);
        }
      } else {
        const license = await generateLicenseWithPrivateKey(payload);
        const hiddenLicense = form.querySelector('input[name="license"]');
        if (hiddenLicense) {
          hiddenLicense.value = license;
        }
        setStatus('Sending activation email...');
        let emailMessage = '';
        try {
          emailMessage = await sendEmailWithServer(payload, license);
          setStatus(emailMessage || 'Activation email sent.');
        } catch (sendError) {
          emailMessage = sendError instanceof Error ? sendError.message : 'Failed to send activation email.';
          setStatus(emailMessage);
        }
        showModal(license, payload.email, emailMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate activation code.';
      setStatus(message);
      console.error('[purchase] activation error', error);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
})();
