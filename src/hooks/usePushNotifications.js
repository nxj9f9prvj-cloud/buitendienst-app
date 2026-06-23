/**
 * usePushNotifications
 *
 * Regelt op native platforms:
 *  1. Toestemming vragen voor push-meldingen
 *  2. Device-token registreren en opslaan in Supabase push_tokens tabel
 *  3. Meldingen ontvangen terwijl app open is (foreground)
 *  4. Tap op melding → deep link naar specifieke werkbon (via localStorage)
 *  5. Badge-reset bij app-opening
 *
 * Werkt alleen op native (iOS/Android). Op web wordt de hook geskipt.
 */
import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../auth/useAuth'
import { useErpRole } from '../auth/useErpRole'

export const PUSH_DEEPLINK_KEY = 'push_deeplink_werkbon_id'

export function usePushNotifications() {
  const { user } = useAuth()
  const { organisatieId } = useErpRole()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (!user?.id) return

    let listeners = []
    let didUnmount = false

    async function setup() {
      try {
        // Vraag toestemming
        let { receive } = await PushNotifications.checkPermissions()
        if (receive === 'prompt' || receive === 'prompt-with-rationale') {
          const result = await PushNotifications.requestPermissions()
          receive = result.receive
        }
        if (receive !== 'granted') return
        if (didUnmount) return

        await PushNotifications.register()

        // Token ontvangen → opslaan in Supabase
        const regListener = await PushNotifications.addListener('registration', async (token) => {
          if (!token?.value) return
          await supabase.from('push_tokens').upsert(
            {
              user_id: user.id,
              organisatie_id: organisatieId || null,
              device_token: token.value,
              platform: Capacitor.getPlatform(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,device_token' },
          )
        })

        // Registratiefout
        const errListener = await PushNotifications.addListener('registrationError', (err) => {
          console.warn('[Push] Registratie mislukt:', err)
        })

        // Melding ontvangen terwijl app open is
        const rcvListener = await PushNotifications.addListener(
          'pushNotificationReceived',
          (notification) => {
            console.log('[Push] Foreground melding:', notification.title)
            // Optioneel: toon een in-app toast hier
          },
        )

        // Tap op melding (ook bij cold start vanuit killed state)
        const actListener = await PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (action) => {
            const data = action.notification?.data ?? {}
            if (data.werkbon_id) {
              // PlanningPageView pikt dit op bij mount/focus
              try {
                localStorage.setItem(PUSH_DEEPLINK_KEY, String(data.werkbon_id))
              } catch { /* storage blocked */ }
            }
          },
        )

        // Wis badge en geleverde meldingen zodra app opengaat
        await PushNotifications.removeAllDeliveredNotifications().catch(() => {})

        listeners = [regListener, errListener, rcvListener, actListener]
      } catch (err) {
        console.warn('[Push] Setup fout:', err)
      }
    }

    setup()

    return () => {
      didUnmount = true
      for (const l of listeners) {
        l?.remove?.()
      }
    }
  }, [user?.id, organisatieId])
}
