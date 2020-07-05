import crypto from "crypto";

export function genSalt(len: number = 8) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex");
}

export function hashPassword(password: string, salt: string) {
  const hash = crypto.createHmac("sha512", salt);
  hash.update(password);
  return {
    salt,
    hash: hash.digest("hex"),
  };
}

export function validatePassword(password: string, hash: string, salt: string) {
  return hashPassword(password, salt).hash === hash;
}
