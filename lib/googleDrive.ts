import { google } from 'googleapis'

function getDriveClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })
  return google.drive({ version: 'v3', auth })
}

export async function getOrCreateCarrierFolder(
  dotNumber: string,
  legalName: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = getDriveClient()
  const parentId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!
  const folderName = `DOT-${dotNumber} — ${legalName.slice(0, 60)}`

  const existing = await drive.files.list({
    q: `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, webViewLink)',
  })

  if (existing.data.files && existing.data.files.length > 0) {
    return {
      id: existing.data.files[0].id!,
      webViewLink: existing.data.files[0].webViewLink!,
    }
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, webViewLink',
  })

  return {
    id: folder.data.id!,
    webViewLink: folder.data.webViewLink!,
  }
}

export async function uploadFileToDrive(
  folderId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = getDriveClient()
  const { Readable } = require('stream')

  const file = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: 'id, webViewLink',
  })

  return {
    id: file.data.id!,
    webViewLink: file.data.webViewLink!,
  }
}
