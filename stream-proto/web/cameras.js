// Remembering which camera is which (the avatar camera and the dice camera).
// Browsers can hand out new camera ids (private windows, cleared site data), so the camera's name is saved too
// and used to find it again.

export function saveCamera(key, device) {          // key: "pac-dice-cam" or "pac-avatar-cam"; device: {deviceId, label} or null
  try {
    localStorage.setItem(key, device ? device.deviceId : "");
    localStorage.setItem(key + "-label", device ? device.label : "");
  } catch (e) {}
}

export async function listCameras() {               // names only show after camera permission, so ask once if needed
  let cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  if (cams.length && !cams[0].label) {
    try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); } catch (e) {}
    cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  }
  return cams;
}

// the deviceId to use now for a saved camera, or "" if none was saved or it isn't plugged in
export async function findCamera(key) {
  let id = "", label = "";
  try { id = localStorage.getItem(key) || ""; label = localStorage.getItem(key + "-label") || ""; } catch (e) {}
  if (!id && !label) return "";
  const cams = await listCameras();
  const hit = cams.find(c => c.deviceId === id) || (label && cams.find(c => c.label === label));
  if (hit && hit.deviceId !== id) saveCamera(key, hit);   // the id changed: remember the new one
  return hit ? hit.deviceId : "";
}
