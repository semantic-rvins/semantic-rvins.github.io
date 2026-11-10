(function () {
  'use strict';

  const options = document.getElementById('video-options');
  const player = document.getElementById('visualization-player');
  const captionMethod = document.getElementById('video-method');
  const openLink = document.getElementById('video-open');

  function showSelection() {
    const choice = options.querySelector('input:checked');
    const src = choice.dataset.src;
    if (player.getAttribute('src') !== src) player.src = src;
    captionMethod.textContent = 'SeA-RVINS (' + choice.value + ')';
    openLink.href = src;
  }

  options.addEventListener('change', showSelection);
  showSelection();
  options.hidden = false;
})();
