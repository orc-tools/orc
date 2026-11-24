// Region Capture restricts the shared image to this inspector's page viewport.
async function capturePage(viewport) {
  if (!window.CropTarget || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Page capture is unavailable in this browser. Open the QA window in Orc.app.');
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' }, preferCurrentTab: true, audio: false,
  });
  try {
    const [track] = stream.getVideoTracks();
    if (!track.cropTo) throw new Error('This browser cannot capture the page region.');
    await track.cropTo(await CropTarget.fromElement(viewport));
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for the page image.')), 5000);
      video.requestVideoFrameCallback(() => { clearTimeout(timeout); resolve(); });
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the screenshot.')), 'image/png'));
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}

export async function copyPageImage(viewport) {
  if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('This browser cannot copy images to the clipboard.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': capturePage(viewport) })]);
}
