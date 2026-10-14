import { describe, expect, it } from 'vitest'
import { supportAttachmentInput } from './support-attachment.validation'

describe('support document validation', () => {
  it('accepts DOCX and XLSX packages and rejects a mismatched Office format', () => {
    const docx = {
      name: 'report.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: 'UEsDBBQAAAAAAFVrTl3HHBc8CAAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcy8+UEsDBBQAAAAAAFVrTl1fW9FMCwAAAAsAAAARAAAAd29yZC9kb2N1bWVudC54bWw8ZG9jdW1lbnQvPlBLAQIUAxQAAAAAAFVrTl3HHBc8CAAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAAAVWtOXV9b0UwLAAAACwAAABEAAAAAAAAAAAAAAIABOQAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAAHMAAAAAAA==',
    }
    const xlsx = {
      name: 'report.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: 'UEsDBBQAAAAAAFVrTl3HHBc8CAAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcy8+UEsDBBQAAAAAAFVrTl1fW9FMCwAAAAsAAAAPAAAAeGwvd29ya2Jvb2sueG1sPGRvY3VtZW50Lz5QSwECFAMUAAAAAABVa05dxxwXPAgAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAAAFVrTl1fW9FMCwAAAAsAAAAPAAAAAAAAAAAAAACAATkAAAB4bC93b3JrYm9vay54bWxQSwUGAAAAAAIAAgB+AAAAcQAAAAAA',
    }
    expect(supportAttachmentInput.safeParse(docx).success).toBe(true)
    expect(supportAttachmentInput.safeParse(xlsx).success).toBe(true)
    expect(
      supportAttachmentInput.safeParse({ ...docx, data: xlsx.data }).success,
    ).toBe(false)
    expect(
      supportAttachmentInput.safeParse({ ...xlsx, data: docx.data }).success,
    ).toBe(false)
  })
})
