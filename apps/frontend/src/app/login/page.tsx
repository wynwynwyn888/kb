// Login page placeholder
// TODO: Implement actual login with Supabase Auth

export default function LoginPage() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>Login</h1>
      <form>
        <div>
          <label htmlFor="email">Email</label>
          <input type="email" id="email" name="email" />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input type="password" id="password" name="password" />
        </div>
        <button type="submit">Sign In</button>
      </form>
      <p>TODO: Implement Supabase Auth login</p>
    </main>
  );
}