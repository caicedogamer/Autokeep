// Vitest global setup hook.

// Polyfill Blob/File .text() and .arrayBuffer() — jsdom 25 does not implement them.
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => {
        resolve(reader.result as string);
      };
      reader.onerror = (): void => {
        reject(new Error(reader.error?.message ?? 'FileReader error'));
      };
      reader.readAsText(this);
    });
  };
}

if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => {
        resolve(reader.result as ArrayBuffer);
      };
      reader.onerror = (): void => {
        reject(new Error(reader.error?.message ?? 'FileReader error'));
      };
      reader.readAsArrayBuffer(this);
    });
  };
}

export {};
