import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createApp, getAudioDir, type InMemoryStores } from "./index.js";
import type { AudioUploadJob, Transcript, User } from "@sonolect/types";

const audioDir = await mkdtemp(join(tmpdir(), "sonolect-api-audio-test-"));
const configuredEnvAudioDir = await mkdtemp(
  join(tmpdir(), "sonolect-api-audio-env-test-"),
);
const storeDir = await mkdtemp(
  join(tmpdir(), "sonolect-api-audio-store-test-"),
);
const app = await createApp({ logger: false, audioDir, audioMaxBytes: 1_024 });

try {
  const created = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    headers: { "x-user-id": "audio-user" },
    payload: {
      fileName: "capture.webm",
      mimeType: "audio/webm",
      sizeBytes: 123_456,
      durationMs: 4_321,
      transcriptTitle: "Audio capture",
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const job = created.json<AudioUploadJob>();
  assert.ok(job.id);
  assert.ok(job.transcriptId);
  assert.equal(job.userId, "audio-user");
  assert.equal(job.status, "queued");
  assert.equal(job.source, "desktop");
  assert.equal(job.fileName, "capture.webm");
  assert.equal(job.mimeType, "audio/webm");
  assert.equal(job.sizeBytes, 123_456);
  assert.equal(job.durationMs, 4_321);
  assert.deepEqual(job.upload, {
    strategy: "inline-metadata",
    storage: "local-placeholder",
  });

  const fetchedJob = await app.inject({
    method: "GET",
    url: `/audio/jobs/${job.id}`,
    headers: { "x-user-id": "audio-user" },
  });
  assert.equal(fetchedJob.statusCode, 200, fetchedJob.body);
  assert.equal(fetchedJob.json<AudioUploadJob>().id, job.id);

  const audioPayload = Buffer.from("fake webm audio bytes");
  const uploaded = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: {
      "x-user-id": "audio-user",
      "content-type": "audio/webm",
    },
    payload: audioPayload,
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const uploadedJob = uploaded.json<AudioUploadJob>();
  assert.equal(uploadedJob.id, job.id);
  assert.equal(uploadedJob.mimeType, "audio/webm");
  assert.equal(uploadedJob.sizeBytes, audioPayload.length);
  assert.equal(uploadedJob.upload.strategy, "binary-local");
  assert.equal(uploadedJob.upload.storage, "local-file");
  assert.equal(uploadedJob.upload.mimeType, "audio/webm");
  assert.equal(uploadedJob.upload.sizeBytes, audioPayload.length);
  assert.ok(uploadedJob.upload.localPath);
  assert.equal(
    relative(audioDir, uploadedJob.upload.localPath).startsWith(".."),
    false,
  );
  assert.deepEqual(await readFile(uploadedJob.upload.localPath), audioPayload);
  assert.equal(
    (await stat(uploadedJob.upload.localPath)).size,
    audioPayload.length,
  );

  const sameNameCreated = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    headers: { "x-user-id": "audio-user" },
    payload: {
      fileName: "capture.webm",
      mimeType: "audio/webm",
      sizeBytes: 111,
      durationMs: 222,
      transcriptTitle: "Audio capture same name",
    },
  });
  assert.equal(sameNameCreated.statusCode, 201, sameNameCreated.body);
  const sameNameJob = sameNameCreated.json<AudioUploadJob>();
  const sameNameUploaded = await app.inject({
    method: "POST",
    url: `/audio/jobs/${sameNameJob.id}/audio`,
    headers: {
      "x-user-id": "audio-user",
      "content-type": "audio/webm",
    },
    payload: Buffer.from("same original filename, different bytes"),
  });
  assert.equal(sameNameUploaded.statusCode, 200, sameNameUploaded.body);
  const sameNameUploadedJob = sameNameUploaded.json<AudioUploadJob>();
  assert.ok(sameNameUploadedJob.upload.localPath);
  assert.notEqual(
    sameNameUploadedJob.upload.localPath,
    uploadedJob.upload.localPath,
  );
  assert.ok(sameNameUploadedJob.upload.localPath.includes(sameNameJob.id));
  assert.ok(uploadedJob.upload.localPath.includes(job.id));
  assert.deepEqual(await readFile(uploadedJob.upload.localPath), audioPayload);

  const fetchedUploaded = await app.inject({
    method: "GET",
    url: `/audio/jobs/${job.id}`,
    headers: { "x-user-id": "audio-user" },
  });
  assert.equal(fetchedUploaded.statusCode, 200, fetchedUploaded.body);
  assert.deepEqual(
    fetchedUploaded.json<AudioUploadJob>().upload,
    uploadedJob.upload,
  );

  const wrongOwnerUpload = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "other-user", "content-type": "audio/webm" },
    payload: Buffer.from("other audio"),
  });
  assert.equal(wrongOwnerUpload.statusCode, 404, wrongOwnerUpload.body);

  const missingJobUpload = await app.inject({
    method: "POST",
    url: "/audio/jobs/../../etc/passwd/audio",
    headers: { "x-user-id": "audio-user", "content-type": "audio/webm" },
    payload: Buffer.from("unsafe"),
  });
  assert.equal(missingJobUpload.statusCode, 404, missingJobUpload.body);

  const invalidContentType = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "audio-user", "content-type": "text/plain" },
    payload: Buffer.from("not audio"),
  });
  assert.equal(invalidContentType.statusCode, 415, invalidContentType.body);

  const tooLarge = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "audio-user", "content-type": "audio/webm" },
    payload: Buffer.alloc(1_025),
  });
  assert.equal(tooLarge.statusCode, 413, tooLarge.body);

  const fetchedTranscript = await app.inject({
    method: "GET",
    url: `/transcripts/${job.transcriptId}`,
    headers: { "x-user-id": "audio-user" },
  });
  assert.equal(fetchedTranscript.statusCode, 200, fetchedTranscript.body);
  const transcript = fetchedTranscript.json<Transcript>();
  assert.equal(transcript.title, "Audio capture");
  assert.equal(transcript.status, "processing");
  assert.equal(transcript.durationMs, 4_321);

  const invalid = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    payload: {
      mimeType: "audio/webm",
      sizeBytes: 0,
      durationMs: -1,
    },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);

  const invalidMimeType = await app.inject({
    method: "POST",
    url: "/audio/jobs",
    payload: {
      mimeType: "text/plain",
      sizeBytes: 12,
      durationMs: 100,
    },
  });
  assert.equal(invalidMimeType.statusCode, 400, invalidMimeType.body);

  const emptyBody = await app.inject({
    method: "POST",
    url: `/audio/jobs/${job.id}/audio`,
    headers: { "x-user-id": "audio-user", "content-type": "audio/webm" },
    payload: Buffer.alloc(0),
  });
  assert.equal(emptyBody.statusCode, 400, emptyBody.body);

  const maliciousUserId = "../../outside:user";
  const maliciousJobId = "../escape-job";
  const maliciousStores = {
    users: new Map<string, User>(),
    transcripts: new Map<string, Transcript>(),
    commands: new Map(),
    audioJobs: new Map<string, AudioUploadJob>([
      [
        maliciousJobId,
        {
          id: maliciousJobId,
          userId: maliciousUserId,
          transcriptId: "transcript:../../escape",
          status: "queued",
          mimeType: "audio/x-..wav",
          sizeBytes: 1,
          source: "desktop",
          upload: { strategy: "inline-metadata", storage: "local-placeholder" },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          fileName: "../../evil.webm",
        } as AudioUploadJob,
      ],
    ]),
  } as InMemoryStores;
  const maliciousApp = await createApp({
    logger: false,
    audioDir,
    stores: maliciousStores,
  });
  try {
    const maliciousUpload = await maliciousApp.inject({
      method: "POST",
      url: `/audio/jobs/${encodeURIComponent(maliciousJobId)}/audio`,
      headers: {
        "x-user-id": maliciousUserId,
        "content-type": "audio/x-..wav",
      },
      payload: Buffer.from("malicious audio"),
    });
    assert.equal(maliciousUpload.statusCode, 200, maliciousUpload.body);
    const maliciousUploadedJob = maliciousUpload.json<AudioUploadJob>();
    assert.ok(maliciousUploadedJob.upload.localPath);
    const maliciousRelative = relative(
      audioDir,
      maliciousUploadedJob.upload.localPath,
    );
    assert.equal(maliciousRelative.startsWith(".."), false);
    assert.equal(maliciousRelative.includes(".."), false);
    assert.equal(maliciousRelative.includes(":"), false);
    assert.deepEqual(
      await readFile(maliciousUploadedJob.upload.localPath),
      Buffer.from("malicious audio"),
    );
  } finally {
    await maliciousApp.close();
  }

  process.env.SONOLECT_API_AUDIO_DIR = configuredEnvAudioDir;
  assert.equal(getAudioDir(undefined), configuredEnvAudioDir);
  const envApp = await createApp({ logger: false });
  try {
    const envCreated = await envApp.inject({
      method: "POST",
      url: "/audio/jobs",
      headers: { "x-user-id": "env-audio-user" },
      payload: { mimeType: "audio/ogg", sizeBytes: 3, durationMs: 1 },
    });
    assert.equal(envCreated.statusCode, 201, envCreated.body);
    const envJob = envCreated.json<AudioUploadJob>();
    const envUploaded = await envApp.inject({
      method: "POST",
      url: `/audio/jobs/${envJob.id}/audio`,
      headers: { "x-user-id": "env-audio-user", "content-type": "audio/ogg" },
      payload: Buffer.from("env"),
    });
    assert.equal(envUploaded.statusCode, 200, envUploaded.body);
    assert.equal(
      relative(
        configuredEnvAudioDir,
        envUploaded.json<AudioUploadJob>().upload.localPath!,
      ).startsWith(".."),
      false,
    );
  } finally {
    delete process.env.SONOLECT_API_AUDIO_DIR;
    await envApp.close();
  }

  const storePath = join(storeDir, "store.json");
  const persistentApp = await createApp({
    logger: false,
    audioDir,
    storePath,
  });
  let persistentJob: AudioUploadJob;
  try {
    const persistentCreated = await persistentApp.inject({
      method: "POST",
      url: "/audio/jobs",
      headers: { "x-user-id": "persist-user" },
      payload: { mimeType: "audio/webm", sizeBytes: 7, durationMs: 1 },
    });
    assert.equal(persistentCreated.statusCode, 201, persistentCreated.body);
    persistentJob = persistentCreated.json<AudioUploadJob>();
    const persistentUploaded = await persistentApp.inject({
      method: "POST",
      url: `/audio/jobs/${persistentJob.id}/audio`,
      headers: { "x-user-id": "persist-user", "content-type": "audio/webm" },
      payload: Buffer.from("persist"),
    });
    assert.equal(persistentUploaded.statusCode, 200, persistentUploaded.body);
    persistentJob = persistentUploaded.json<AudioUploadJob>();

    const storeAfterUpload = JSON.parse(await readFile(storePath, "utf8")) as {
      audioJobs: AudioUploadJob[];
      transcripts: Transcript[];
    };
    const externallyCompletedJob: AudioUploadJob = {
      ...persistentJob,
      status: "completed",
      completedAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    await writeFile(
      storePath,
      `${JSON.stringify(
        {
          ...storeAfterUpload,
          audioJobs: storeAfterUpload.audioJobs.map((audioJob) =>
            audioJob.id === persistentJob.id
              ? externallyCompletedJob
              : audioJob,
          ),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const secondPersistentCreated = await persistentApp.inject({
      method: "POST",
      url: "/audio/jobs",
      headers: { "x-user-id": "persist-user" },
      payload: { mimeType: "audio/webm", sizeBytes: 9, durationMs: 2 },
    });
    assert.equal(
      secondPersistentCreated.statusCode,
      201,
      secondPersistentCreated.body,
    );
    const storeAfterSecondCreate = JSON.parse(
      await readFile(storePath, "utf8"),
    ) as { audioJobs: AudioUploadJob[] };
    assert.equal(storeAfterSecondCreate.audioJobs.length, 2);
    assert.equal(
      storeAfterSecondCreate.audioJobs.find(
        (audioJob) => audioJob.id === persistentJob.id,
      )?.status,
      "completed",
    );
    assert.ok(
      storeAfterSecondCreate.audioJobs.find(
        (audioJob) =>
          audioJob.id === secondPersistentCreated.json<AudioUploadJob>().id,
      ),
    );
    persistentJob = externallyCompletedJob;
  } finally {
    await persistentApp.close();
  }
  const reloadedApp = await createApp({
    logger: false,
    audioDir,
    storePath,
  });
  try {
    const reloaded = await reloadedApp.inject({
      method: "GET",
      url: `/audio/jobs/${persistentJob.id}`,
      headers: { "x-user-id": "persist-user" },
    });
    assert.equal(reloaded.statusCode, 200, reloaded.body);
    assert.deepEqual(
      reloaded.json<AudioUploadJob>().upload,
      persistentJob.upload,
    );
    assert.deepEqual(
      await readFile(persistentJob.upload.localPath!),
      Buffer.from("persist"),
    );
  } finally {
    await reloadedApp.close();
  }

  const invalidAudioDirPath = join(storeDir, "not-a-directory");
  await writeFile(invalidAudioDirPath, "not a directory");
  await assert.rejects(
    () => createApp({ logger: false, audioDir: invalidAudioDirPath }),
    /Audio storage root is not a directory/,
  );
  assert.throws(() => getAudioDir("\0bad"), /Invalid audio storage root/);
} finally {
  delete process.env.SONOLECT_API_AUDIO_DIR;
  await app.close();
  await rm(audioDir, { recursive: true, force: true });
  await rm(configuredEnvAudioDir, { recursive: true, force: true });
  await rm(storeDir, { recursive: true, force: true });
}

console.log("API audio upload job smoke test passed");
