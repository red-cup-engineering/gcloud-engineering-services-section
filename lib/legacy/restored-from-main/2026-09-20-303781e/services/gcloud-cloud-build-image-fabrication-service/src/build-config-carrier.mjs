import { createHash } from "node:crypto";

const BUILDER = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9][0-9]{0,4})?\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*@sha256:[a-f0-9]{64}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const CONTENT_ID = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;

function exactRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\")) throw new TypeError(`${label} must be one POSIX relative path`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..") || !/^[A-Za-z0-9._/-]+$/u.test(value)) throw new TypeError(`${label} contains traversal, substitution syntax, unsafe characters, or an empty segment`);
  return segments.join("/");
}
function overlaps(left, right) { return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`); }

function exactInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Cloud Build carrier input must be one record");
  const allowed = new Set(["builderImage", "dockerfilePath", "path"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length !== 0) throw new TypeError(`Cloud Build carrier input has unknown members: ${unknown.join(", ")}`);
  return value;
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new TypeError("Cloud Build carrier identity accepts only finite JSON values");
}
function identity(value) { return `ni:///sha-256;${createHash("sha256").update(canonical(value)).digest("base64url")}`; }

function bodyFor({ builderImage, dockerfilePath, path }) {
  if (typeof builderImage !== "string" || !BUILDER.test(builderImage)) throw new TypeError("builderImage must be one digest-pinned container image reference");
  const dockerfile = exactRelativePath(dockerfilePath ?? "Dockerfile", "dockerfilePath");
  const carrierPath = exactRelativePath(path ?? "cloudbuild.image.json", "build configuration path");
  if (overlaps(carrierPath, dockerfile)) throw new TypeError("build configuration and Dockerfile paths must not overlap");
  const args = Object.freeze(["build", "--pull", ...(dockerfile === "Dockerfile" ? [] : ["--file", dockerfile]), "--tag", "${_IMAGE}", "."]);
  const configuration = Object.freeze({
    steps: Object.freeze([Object.freeze({ name: builderImage, args })]),
    images: Object.freeze(["${_IMAGE}"]),
    options: Object.freeze({ logging: "CLOUD_LOGGING_ONLY", requestedVerifyOption: "VERIFIED" }),
  });
  const utf8 = `${JSON.stringify(configuration, null, 2)}\n`;
  const carrier = Object.freeze({ path: carrierPath, mode: 0o644, utf8, bytes: Buffer.byteLength(utf8), sha256: `sha256:${createHash("sha256").update(utf8).digest("hex")}` });
  const staticCarriers = Object.freeze([Object.freeze({ path: carrier.path, mode: carrier.mode, utf8: carrier.utf8 })]);
  return Object.freeze({ type: "CloudBuildImageBuildConfigCarrier", version: 1, configuration, carrier, staticCarriers });
}

/** Forms one deterministic Cloud Build configuration carrier; it performs no build or filesystem effect. */
export function formCloudBuildImageBuildConfigCarrier(input = {}) {
  const body = bodyFor(exactInput(input));
  return Object.freeze({ id: identity(body), ...body });
}

/** Recomputes the exact configuration bytes and content identity before admitting a carrier. */
export function admitCloudBuildImageBuildConfigCarrier(value) {
  if (value?.type !== "CloudBuildImageBuildConfigCarrier" || value.version !== 1 || !CONTENT_ID.test(value.id ?? "") || typeof value.carrier?.utf8 !== "string") throw new TypeError("value is not one Cloud Build image build configuration carrier");
  const builderImage = value.configuration?.steps?.[0]?.name;
  const args = value.configuration?.steps?.[0]?.args;
  const dockerfileIndex = Array.isArray(args) ? args.indexOf("--file") : -1;
  if (dockerfileIndex >= 0 && dockerfileIndex + 1 >= args.length) throw new TypeError("Cloud Build carrier has no exact Dockerfile argument");
  const expected = formCloudBuildImageBuildConfigCarrier({ builderImage, dockerfilePath: dockerfileIndex < 0 ? "Dockerfile" : args[dockerfileIndex + 1], path: value.carrier.path });
  if (JSON.stringify(value) !== JSON.stringify(expected) || !SHA256.test(value.carrier.sha256 ?? "")) throw new TypeError("Cloud Build carrier bytes, configuration, or content identity are invalid");
  return expected;
}
