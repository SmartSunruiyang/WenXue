import { Camera, Copy, LogOut, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { LauncherPublicUser } from './cloudbase'
import { strings } from './strings'

export interface AccountSettingsProps {
	user: LauncherPublicUser
	onSave: (input: { nickname: string; avatar?: File }) => Promise<void>
	onLogout: () => Promise<void>
	logoutBusy: boolean
	disabled: boolean
}

export function AccountSettings(props: AccountSettingsProps) {
	return <AccountProfileForm key={props.user.userId} {...props} />
}

function AccountProfileForm({
	user,
	onSave,
	onLogout,
	logoutBusy,
	disabled,
}: AccountSettingsProps) {
	const id = useId()
	const fileInput = useRef<HTMLInputElement>(null)
	const savingRef = useRef(false)
	const mountedRef = useRef(true)
	const [nicknameDraft, setNicknameDraft] = useState<string | null>(null)
	const [avatar, setAvatar] = useState<File>()
	const [preview, setPreview] = useState<string>()
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const copy = strings.account
	const nickname = nicknameDraft ?? user.nickname ?? ''
	const busy = disabled || saving || logoutBusy
	const changed = nickname !== (user.nickname ?? '') || Boolean(avatar)
	const avatarUrl = preview ?? user.avatarUrl

	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
		}
	}, [])

	useEffect(
		() => () => {
			if (preview) URL.revokeObjectURL(preview)
		},
		[preview],
	)

	const selectAvatar = (file?: File) => {
		setAvatar(file)
		setPreview(file ? URL.createObjectURL(file) : undefined)
		setError(null)
		setNotice(null)
	}

	const save = async () => {
		if (busy || savingRef.current || !changed) return
		savingRef.current = true
		setSaving(true)
		setError(null)
		setNotice(null)
		try {
			await onSave({ nickname, avatar })
			if (!mountedRef.current) return
			setNicknameDraft(null)
			setAvatar(undefined)
			setPreview(undefined)
			setNotice(copy.saved)
		} catch (failure) {
			if (mountedRef.current)
				setError(failure instanceof Error ? failure.message : copy.errors.save)
		} finally {
			savingRef.current = false
			if (mountedRef.current) setSaving(false)
		}
	}

	return (
		<section className="account-settings" aria-labelledby={`${id}-heading`}>
			<header className="account-settings__heading">
				<h2 id={`${id}-heading`}>{copy.title}</h2>
				<p>{copy.description}</p>
			</header>
			<form
				className="account-settings__form"
				onSubmit={(event) => {
					event.preventDefault()
					void save()
				}}
			>
				<div className="account-settings__avatar-row">
					<div className="account-settings__avatar">
						{avatarUrl ? (
							<img src={avatarUrl} alt={copy.avatarAlt} />
						) : (
							<UserRound size={28} aria-hidden="true" />
						)}
					</div>
					<div className="account-settings__avatar-actions">
						<div className="account-settings__avatar-buttons">
							<button
								className="account-settings__button"
								type="button"
								disabled={busy}
								onClick={() => fileInput.current?.click()}
							>
								<Camera size={15} aria-hidden="true" />
								{copy.changeAvatar}
							</button>
							{avatar && (
								<button
									className="account-settings__button account-settings__button--quiet"
									type="button"
									disabled={busy}
									onClick={() => selectAvatar()}
								>
									{copy.cancelAvatar}
								</button>
							)}
						</div>
						<p id={`${id}-avatar-hint`}>{copy.avatarHint}</p>
						<input
							ref={fileInput}
							type="file"
							accept="image/png,image/jpeg,image/webp"
							aria-label={copy.avatar}
							aria-describedby={`${id}-avatar-hint`}
							disabled={busy}
							hidden
							onChange={(event) => {
								const file = event.target.files?.[0]
								if (file) selectAvatar(file)
								event.target.value = ''
							}}
						/>
					</div>
				</div>
				<div className="account-settings__field">
					<label htmlFor={`${id}-nickname`}>{copy.nickname}</label>
					<input
						id={`${id}-nickname`}
						className="account-settings__input"
						value={nickname}
						autoComplete="nickname"
						aria-describedby={`${id}-nickname-hint`}
						disabled={busy}
						onChange={(event) => {
							setNicknameDraft(event.target.value)
							setError(null)
							setNotice(null)
						}}
					/>
					<p id={`${id}-nickname-hint`}>{copy.nicknameHint}</p>
				</div>
				<div className="account-settings__field">
					<label htmlFor={`${id}-uid`}>{copy.uid}</label>
					<div className="account-settings__uid-row">
						<input
							id={`${id}-uid`}
							className="account-settings__input account-settings__input--uid"
							value={user.userId}
							readOnly
							spellCheck={false}
							aria-describedby={`${id}-uid-hint`}
						/>
						<button
							type="button"
							className="account-settings__button account-settings__copy"
							aria-label={copy.copyUid}
							title={copy.copyUid}
							onClick={() => {
								void navigator.clipboard
									?.writeText(user.userId)
									.then(() => {
										if (!mountedRef.current) return
										setError(null)
										setNotice(copy.copied)
									})
									.catch(() => {
										if (mountedRef.current) setError(copy.errors.copy)
									})
								if (!navigator.clipboard) setError(copy.errors.copy)
							}}
						>
							<Copy size={15} aria-hidden="true" />
						</button>
					</div>
					<p id={`${id}-uid-hint`}>{copy.uidHint}</p>
				</div>
				{user.email && (
					<div className="account-settings__field">
						<label htmlFor={`${id}-email`}>{copy.email}</label>
						<input
							id={`${id}-email`}
							className="account-settings__input"
							value={user.email}
							readOnly
						/>
					</div>
				)}
				<div className="account-settings__save-row">
					<button
						type="submit"
						className="account-settings__button account-settings__button--primary"
						disabled={busy || !changed}
					>
						{saving ? copy.saving : copy.save}
					</button>
					{notice && <p role="status">{notice}</p>}
				</div>
				{error && (
					<p className="account-settings__error" role="alert">
						{error}
					</p>
				)}
			</form>
			<div className="account-settings__logout-row">
				<p>{copy.logoutHint}</p>
				<button
					type="button"
					className="account-settings__button account-settings__button--logout"
					disabled={busy}
					onClick={() => {
						setError(null)
						void onLogout().catch((failure: unknown) => {
							if (mountedRef.current)
								setError(failure instanceof Error ? failure.message : strings.auth.error.logout)
						})
					}}
				>
					<LogOut size={15} aria-hidden="true" />
					{logoutBusy ? copy.loggingOut : copy.logout}
				</button>
			</div>
		</section>
	)
}
