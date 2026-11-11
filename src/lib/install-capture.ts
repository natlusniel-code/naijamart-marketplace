/**
 * The inline `beforeinstallprompt` capture script.
 *
 * Deliberately in its own module with NO "use client" directive: it is
 * imported by the server-rendered root layout, which only needs the string.
 * Keeping it out of `install-app.ts` (a client module) avoids pulling the
 * whole client bundle into the server component just to read a constant.
 *
 * Why inline at all: `beforeinstallprompt` can fire before React hydrates,
 * and the event is single-use. If nothing is listening at that moment, the
 * ability to open the install dialog from our own button is lost for the
 * whole page load. This runs in the document head, before any component.
 */
export const INSTALL_CAPTURE_SCRIPT = `
(function(){
  window.__nmInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    window.__nmInstallPrompt = e;
    window.dispatchEvent(new Event('nm:install-available'));
  });
  window.addEventListener('appinstalled', function(){
    try { localStorage.setItem('nm:app-installed','1'); } catch(_) {}
    window.__nmInstallPrompt = null;
    window.dispatchEvent(new Event('nm:install-available'));
  });
})();
`;
