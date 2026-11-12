export function transferFiles(transfer) {
  const items = Array.from(transfer?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile()).filter(Boolean);
  return items.length ? items : Array.from(transfer?.files || []);
}

export function hasFileTransfer(transfer) {
  return Array.from(transfer?.types || []).includes('Files')
    || Array.from(transfer?.items || []).some(item => item.kind === 'file');
}
