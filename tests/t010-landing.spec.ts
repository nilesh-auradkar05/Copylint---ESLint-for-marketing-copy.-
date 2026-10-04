import { test, expect } from 'deepspace/testing'

test('[T-010.1] signed-out landing shows the launch-thread comparison and sign-in without data connections', async ({ page }) => {
  const connections: string[] = []
  page.on('request', request => {
    if (/\/api\/(auth|records)(\/|\?)/.test(new URL(request.url()).pathname)) connections.push(request.url())
  })
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname.startsWith('/ws/')) connections.push(socket.url())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign in/i }).or(page.getByRole('button', { name: /sign in/i })).first()).toBeVisible()
  await expect(page.getByText(/paid APIs are auth-gated/i)).toBeVisible()
  await expect(page.getByText(/before/i).first()).toBeVisible()
  await expect(page.getByText(/after/i).first()).toBeVisible()
  // Allow mount effects to run; Vite's HMR socket is intentionally excluded.
  await page.waitForTimeout(1500)
  expect(connections).toEqual([])
})
