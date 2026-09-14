/** 仅表单型存储后端需要的上传凭证字段。 */
export interface FormUploadCredential {
  formFields?: Readonly<Record<string, string>>;
  fileField?: string;
}

/**
 * 根据存储后端返回的凭证构造请求体。
 *
 * LocalProvider 的签名上限等于原始文件大小，必须直接发送 File；如果包成
 * multipart，boundary 和表单头会让请求体超过签名上限并触发 413。
 * CS 等表单型后端会显式返回 formFields/fileField，仍按 multipart 上传。
 */
export function buildUploadRequestBody(
  file: File,
  credential: FormUploadCredential,
): File | FormData {
  const formFields = credential.formFields ?? {};
  const usesMultipart = Object.keys(formFields).length > 0 || Boolean(credential.fileField);
  if (!usesMultipart) return file;

  const form = new FormData();
  for (const [key, value] of Object.entries(formFields)) {
    form.append(key, value);
  }
  form.append(credential.fileField || "filename", file, file.name);
  return form;
}
