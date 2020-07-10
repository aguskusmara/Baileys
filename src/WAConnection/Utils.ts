import * as Crypto from 'crypto'
import HKDF from 'futoin-hkdf'
import Decoder from '../Binary/Decoder'
import { off } from 'process'

/** decrypt AES 256 CBC; where the IV is prefixed to the buffer */
export function aesDecrypt(buffer: Buffer, key: Buffer) {
    return aesDecryptWithIV(buffer.slice(16, buffer.length), key, buffer.slice(0, 16))
}
/** decrypt AES 256 CBC */
export function aesDecryptWithIV(buffer: Buffer, key: Buffer, IV: Buffer) {
    const aes = Crypto.createDecipheriv('aes-256-cbc', key, IV)
    return Buffer.concat([aes.update(buffer), aes.final()])
}
// encrypt AES 256 CBC; where a random IV is prefixed to the buffer
export function aesEncrypt(buffer: Buffer, key: Buffer) {
    const IV = randomBytes(16)
    const aes = Crypto.createCipheriv('aes-256-cbc', key, IV)
    return Buffer.concat([IV, aes.update(buffer), aes.final()]) // prefix IV to the buffer
}
// encrypt AES 256 CBC with a given IV
export function aesEncrypWithIV(buffer: Buffer, key: Buffer, IV: Buffer) {
    const aes = Crypto.createCipheriv('aes-256-cbc', key, IV)
    return Buffer.concat([aes.update(buffer), aes.final()]) // prefix IV to the buffer
}
// sign HMAC using SHA 256
export function hmacSign(buffer: Buffer, key: Buffer) {
    return Crypto.createHmac('sha256', key).update(buffer).digest()
}
export function sha256(buffer: Buffer) {
    return Crypto.createHash('sha256').update(buffer).digest()
}
// HKDF key expansion
export function hkdf(buffer: Buffer, expandedLength: number, info = null) {
    return HKDF(buffer, expandedLength, { salt: Buffer.alloc(32), info: info, hash: 'SHA-256' })
}
// generate a buffer with random bytes of the specified length
export function randomBytes(length) {
    return Crypto.randomBytes(length)
}
export const createTimeout = (timeout) => new Promise(resolve => setTimeout(resolve, timeout))
export function promiseTimeout<T>(ms: number, promise: Promise<T>) {
    if (!ms) {
        return promise
    }
    // Create a promise that rejects in <ms> milliseconds
    const timeout = new Promise((_, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id)
            reject('Timed out')
        }, ms)
    })
    return Promise.race([promise, timeout]) as Promise<T>
}
// whatsapp requires a message tag for every message, we just use the timestamp as one
export function generateMessageTag(epoch?: number) {
    let tag = new Date().getTime().toString()
    if (epoch) tag += '-' + epoch // attach epoch if provided
    return tag
}
// generate a random 16 byte client ID
export function generateClientID() {
    return randomBytes(16).toString('base64')
}
// generate a random 10 byte ID to attach to a message
export function generateMessageID() {
    return randomBytes(10).toString('hex').toUpperCase()
}

export function errorOnNon200Status(p: Promise<any>) {
    return p.then(json => {
        if (json.status && typeof json.status === 'number' && Math.floor(json.status / 100) !== 2) {
            throw new Error(`Unexpected status code: ${json.status}`)
        }
        return json
    })
}

export function decryptWA (message: any, macKey: Buffer, encKey: Buffer, decoder: Decoder, fromMe: boolean=false): [string, Object, [number, number]?] {
    const commaIndex = message.indexOf(',') // all whatsapp messages have a tag and a comma, followed by the actual message
    if (commaIndex < 0) {
        // if there was no comma, then this message must be not be valid
        throw [2, 'invalid message', message]
    }
    let data = message.slice(commaIndex+1, message.length)
    // get the message tag.
    // If a query was done, the server will respond with the same message tag we sent the query with
    const messageTag: string = message.slice(0, commaIndex).toString()
    if (data.length === 0) {
        // got an empty message, usually get one after sending a query with the 128 tag
        return 
    }

    let json
    let tags = null
    if (data[0] === '[' || data[0] === '{') {
        // if the first character is a "[", then the data must just be plain JSON array or object
        json = JSON.parse(data) // parse the JSON
    } else {
        if (!macKey || !encKey) {
            // if we recieved a message that was encrypted but we don't have the keys, then there must be an error
            throw [3, 'recieved encrypted message when auth creds not available', data]
        }
        /* 
            If the data recieved was not a JSON, then it must be an encrypted message.
            Such a message can only be decrypted if we're connected successfully to the servers & have encryption keys
        */
        if (fromMe) {
            tags = [data[0], data[1]]
            data = data.slice(2, data.length)
        }
        
        const checksum = data.slice(0, 32) // the first 32 bytes of the buffer are the HMAC sign of the message
        data = data.slice(32, data.length) // the actual message
        const computedChecksum = hmacSign(data, macKey) // compute the sign of the message we recieved using our macKey
        
        if (!checksum.equals(computedChecksum)) {
            throw [7, "checksums don't match"]
        }
        
        // the checksum the server sent, must match the one we computed for the message to be valid
        const decrypted = aesDecrypt(data, encKey) // decrypt using AES
        json = decoder.read(decrypted) // decode the binary message into a JSON array
    }
    return [messageTag, json, tags]
}