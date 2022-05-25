import { proto } from '../../WAProto'
import { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types'
import { initAuthCreds } from './auth-utils'
import { BufferJSON } from './generics'


/**
 * stores the full authentication state in a single folder.
 * Far more efficient than singlefileauthstate
 *
 * Again, I wouldn't endorse this for any production level use other than perhaps a bot.
 * Would recommend writing an auth state for use with a proper SQL or No-SQL DB
 * */
export const useRedisAuthState = async(fileName: string,redis : any): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void>}> => {

	const writeData = (data: any, file: string) => {
			return redis.set(fileName +'_'+file,JSON.stringify(data, BufferJSON.replacer))
	}

	const readKeys = async(key:string){
			let cek = await readData('keys')
			if(cek){
				return cek[key]
			}
	}

	const writeKeys = async(data : any,key:string){
				let cek = await readData('keys') || {}
				if(data){
					cek[key] = data
				}else{
					delete cek[key]
				}
				return writeData(cek,'keys')
	}
	
	const readData = async(file: string,key : boolean = true) => {
		try {
				const data = await redis.get(fileName +'_'+file)
				return JSON.parse(data, BufferJSON.reviver)
		} catch(error) {
			return null
		}
	}

	const creds: AuthenticationCreds = await readData('creds') || initAuthCreds()

	return {
		state: {
			creds,
			keys: {
				get: async(type, ids) => {
					const data: { [_: string]: SignalDataTypeMap[typeof type] } = { }
					await Promise.all(
						ids.map(
							async id => {
								let value = await readKeys(`${type}-${id}`)
								if(type === 'app-state-sync-key') {
									value = proto.AppStateSyncKeyData.fromObject(value)
								}

								data[id] = value
							}
						)
					)

					return data
				},
				set: async(data) => {
					const tasks: Promise<void>[] = []
					for(const category in data) {
						for(const id in data[category]) {
							const value = data[category][id]
							const file = `${category}-${id}`
							tasks.push(writeKeys(value, file))
						}
					}

					await Promise.all(tasks)
				}
			}
		},
		saveCreds: () => {
			return writeData(creds, 'creds')
		}
	}
}
