let _authenticated = false
let _listeners: Array<() => void> = []

export function isAuthenticated(): boolean {
  return _authenticated
}

export function setAuthenticated(value: boolean): void {
  _authenticated = value
  _listeners.forEach((l) => l())
}

export function subscribeAuth(listener: () => void): () => void {
  _listeners.push(listener)
  return () => {
    _listeners = _listeners.filter((l) => l !== listener)
  }
}

export function getAuthSnapshot(): boolean {
  return _authenticated
}
