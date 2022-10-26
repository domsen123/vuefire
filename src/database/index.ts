import {
  Ref,
  ref,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
  ShallowRef,
  unref,
  watch,
  isRef,
} from 'vue-demi'
import type { DatabaseReference, Query } from 'firebase/database'
import {
  noop,
  OperationsType,
  walkSet,
  _MaybeRef,
  _RefWithState,
} from '../shared'
import { rtdbUnbinds } from './optionsApi'
import { bindAsArray, bindAsObject, _DatabaseRefOptions } from './subscribe'

export { databasePlugin } from './optionsApi'

// TODO: if we allow passing them locally, we could also add the create and reset to allow creating other data structures like a Map

const ops: OperationsType = {
  set: (target, key, value) => walkSet(target, key, value),
  add: (array, index, data) => array.splice(index, 0, data),
  remove: (array, index) => array.splice(index, 1),
}

export interface UseDatabaseRefOptions extends _DatabaseRefOptions {
  target?: Ref<unknown>
}

type UnbindType = ReturnType<typeof bindAsArray | typeof bindAsObject>

export function _useDatabaseRef(
  reference: _MaybeRef<DatabaseReference | Query>,
  options: UseDatabaseRefOptions = {}
) {
  let _unbind!: UnbindType

  const data = options.target || ref<unknown | null>(options.initialValue)
  const error = ref<Error>()
  const pending = ref(true)
  // force the type since its value is set right after and undefined isn't possible
  const promise = shallowRef() as ShallowRef<Promise<unknown | null>>
  const createdPromises = new Set<Promise<unknown | null>>()
  const hasCurrentScope = getCurrentScope()

  function bindDatabaseRef() {
    const p = new Promise<unknown | null>((resolve, reject) => {
      const referenceValue = unref(reference)
      if (Array.isArray(data.value)) {
        _unbind = bindAsArray(
          {
            target: data,
            collection: referenceValue,
            resolve,
            reject,
            ops,
          },
          options
        )
      } else {
        _unbind = bindAsObject(
          {
            target: data,
            document: referenceValue,
            resolve,
            reject,
            ops,
          },
          options
        )
      }
    })

    // only add the first promise to the pending ones
    if (!createdPromises.size) {
      // TODO: add the pending promise like in firestore
      // pendingPromises.add(p)
    }
    createdPromises.add(p)
    promise.value = p

    p.catch((reason) => {
      error.value = reason
    }).finally(() => {
      pending.value = false
    })

    // TODO: SSR serialize the values for Nuxt to expose them later and use them
    // as initial values while specifying a wait: true to only swap objects once
    // Firebase has done its initial sync. Also, on server, you don't need to
    // create sync, you can read only once the whole thing so maybe _useDatabaseRef
    // should take an option like once: true to not setting up any listener
  }

  let stopWatcher: ReturnType<typeof watch> = noop
  if (isRef(reference)) {
    stopWatcher = watch(reference, bindDatabaseRef, { immediate: true })
  } else {
    bindDatabaseRef()
  }

  if (hasCurrentScope) {
    onScopeDispose(() => {
      // TODO: clear pending promises
      // for (const p of createdPromises) {
      //   pendingPromises.delete(p)
      // }
      _unbind(options.reset)
    })
  }

  // TODO: rename to stop
  function unbind() {
    stopWatcher()
    _unbind(options.reset)
  }

  return Object.defineProperties(data, {
    data: { get: () => data },
    error: { get: () => error },
    pending: { get: () => error },

    promise: { get: () => promise },
    unbind: { get: () => unbind },
  }) as _RefDatabase<unknown | null>
}

export function internalUnbind(
  key: string,
  unbinds: Record<string, UnbindType> | undefined,
  reset?: _DatabaseRefOptions['reset']
) {
  if (unbinds && unbinds[key]) {
    unbinds[key](reset)
    delete unbinds[key]
  }
  // TODO: move to $firestoreUnbind
  // delete vm._firebaseSources[key]
  // delete vm._firebaseUnbinds[key]
}

export type UseListOptions = UseDatabaseRefOptions
export type UseObjectOptions = UseDatabaseRefOptions

/**
 * Creates a reactive variable connected to the database.
 *
 * @param reference - Reference or query to the database
 * @param options - optional options
 */
export function useList<T = unknown>(
  reference: _MaybeRef<DatabaseReference | Query>,
  options?: UseListOptions
): _RefDatabase<VueDatabaseQueryData<T>> {
  const unbinds = {}
  const data = ref<T[]>([]) as Ref<T[]>
  return _useDatabaseRef(reference, {
    target: data,
    ...options,
  }) as _RefDatabase<VueDatabaseQueryData<T>>
}

export function useObject<T = unknown>(
  reference: _MaybeRef<DatabaseReference>,
  options?: UseObjectOptions
): _RefDatabase<VueDatabaseDocumentData<T> | undefined> {
  const data = ref<T>() as Ref<T | undefined>
  return _useDatabaseRef(reference, {
    target: data,
    ...options,
  }) as _RefDatabase<VueDatabaseDocumentData<T> | undefined>
}

export const unbind = (target: Ref, reset?: _DatabaseRefOptions['reset']) =>
  internalUnbind('', rtdbUnbinds.get(target), reset)

export interface _RefDatabase<T> extends _RefWithState<T, Error> {}

/**
 * Type used by default by the `serialize` option.
 */
export type VueDatabaseDocumentData<T = unknown> =
  | null
  | (T & {
      /**
       * id of the document
       */
      readonly id: string
    })

/**
 * Same as VueDatabaseDocumentData but for a query.
 */
export type VueDatabaseQueryData<T = unknown> = Array<
  Exclude<VueDatabaseDocumentData<T>, null>
>