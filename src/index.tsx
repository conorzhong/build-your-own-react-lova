/** requestIdleCallback */
// https://github.com/Microsoft/TypeScript/issues/21309#issuecomment-376338415
// https://ts.xcatliu.com/basics/declaration-files.html#declare-global
type RequestIdleCallbackHandle = any;
type RequestIdleCallbackOptions = {
  timeout: number;
};
type RequestIdleCallbackDeadline = {
  readonly didTimeout: boolean;
  timeRemaining: () => number;
};

interface Window {
  requestIdleCallback: (
    callback: (deadline: RequestIdleCallbackDeadline) => void,
    opts?: RequestIdleCallbackOptions
  ) => RequestIdleCallbackHandle;
  cancelIdleCallback: (handle: RequestIdleCallbackHandle) => void;
}

type Fiber = {
  type: string | "TEXT_FIBER" | "ROOT_FIBER" | Function;
  dom?: HTMLElement | Text;
  props: {
    children: Fiber[];
    nodeValue?: string;
    [prop: string]: any;
  };

  parent?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  alternate?: Fiber;

  effectTag?: "UPDATE" | "PLACEMENT" | "DELETION";

  hooks?: Hook<any>[];
};

let nextUnitOfWork: Fiber | undefined;
let wipRoot: Fiber | undefined;
let currentRoot: Fiber | undefined; // last fiber tree we committed to the DOM
let deletions: Fiber[] | undefined; // 每次构建 wipRoot 都要初始化

function createTextElement(text: string): Fiber {
  return {
    type: "TEXT_FIBER",
    props: {
      nodeValue: text,
      children: []
    }
  };
}

function createElement(
  type: string,
  props: Fiber["props"],
  ...children: (Fiber | string)[]
): Fiber {
  return {
    type,
    props: {
      ...props,
      children: children.map((fiberOrString) =>
        typeof fiberOrString === "object"
          ? fiberOrString
          : createTextElement(fiberOrString)
      )
    }
  };
}

function createDOMOf(fiber: Fiber): HTMLElement | Text {
  return fiber.type === "TEXT_FIBER"
    ? document.createTextNode("")
    : document.createElement(fiber.type as string); // Function component 没有 dom
}

const isEvent = (key: string) => key.startsWith("on"),
  isProperty = (key: string) => key !== "children" && !isEvent(key),
  isNew = <T extends object>(prev: T, next: T) => (key: keyof T) =>
    prev[key] !== next[key],
  isGone = <T extends object>(next: T) => (key: keyof T) => !(key in next),
  isNewOrGone = <T extends object>(prev: T, next: T) =>
    isNew<T>(prev, next) || isGone<T>(next);
function updateDOMOf(fiber: Fiber) {
  const dom = fiber.dom!,
    prevProps: Fiber["props"] = fiber.alternate?.props ?? { children: [] },
    nextProps = fiber.props;

  // remove old event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(isNewOrGone(prevProps, nextProps))
    .forEach((name) => {
      const eventName = name.toLowerCase().substring(2);
      dom.removeEventListener(eventName, prevProps[name]);
    });

  // remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(nextProps))
    .forEach((name) => {
      dom[name] = "";
    });

  // set new/changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      dom[name] = nextProps[name];
    });

  // add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2);
      dom.addEventListener(eventType, nextProps[name]);
    });
}

function attachDOM2(fiber: Fiber) {
  fiber.dom = createDOMOf(fiber);
  updateDOMOf(fiber);
}

function reconcileChildren(wipFiber: Fiber, elements: Fiber[]) {
  // create new fibers
  let index = 0;
  let oldFiber = wipFiber.alternate?.child;
  let prevSibling: Fiber | undefined;

  while (index < elements.length || oldFiber) {
    const fiber: Fiber | undefined = elements[index]; // 注意 fiber 可能不存在（while 的 oldFiber）
    let newFiber: Fiber | undefined;

    // compare oldFiber to fiber
    if (oldFiber && fiber && fiber.type === oldFiber.type) {
      // isSameType
      newFiber = {
        effectTag: "UPDATE",

        type: oldFiber.type,
        props: fiber.props,
        dom: oldFiber.dom,

        parent: wipFiber,
        alternate: oldFiber
      };
    } else {
      if (fiber) {
        newFiber = {
          effectTag: "PLACEMENT",

          type: fiber.type,
          props: fiber.props,
          dom: undefined,

          parent: wipFiber,
          alternate: undefined
        };
      }
      if (oldFiber) {
        // delete the oldFiber's node
        oldFiber.effectTag = "DELETION";
        deletions!.push(oldFiber);
      }
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (fiber) {
      // 能进入这个块 => index !== 0 && fiber，则之前位置的 fiber 都存在，所以 prevSibling!
      prevSibling!.sibling = newFiber; // fiber 则 newFiber 一定存在
    }

    prevSibling = newFiber;
    index++;
    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }
  }
}

function updateHostComponent(fiber: Fiber) {
  if (!fiber.dom) {
    attachDOM2(fiber);
  }
  reconcileChildren(fiber, fiber.props.children);
}

type Hook<T> = {
  state: T;
  queue: Action<T>[];
};
type Action<T> = (state: T) => T;
type SetStateWithAction<T> = (action: Action<T>) => void;

let wipFiber: Fiber;
let hookIndex: number;

function updateFunctionComponent(fiber: Fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];

  const fn = fiber.type as Function;
  const children = [fn(fiber.props)];
  reconcileChildren(fiber, children);
}

function useState<T>(initial: T): [T, SetStateWithAction<T>] {
  const oldHook = wipFiber.alternate?.hooks?.[hookIndex];
  const hook: Hook<T> = {
    state: oldHook ? oldHook.state : initial,
    queue: []
  };

  const actions = oldHook ? oldHook.queue : [];
  actions.forEach((action) => {
    hook.state = action(hook.state);
  });

  const setState: SetStateWithAction<T> = (action) => {
    hook.queue.push(action);

    // like in render
    wipRoot = {
      type: "ROOT_FIBER",
      dom: currentRoot.dom, // bug，currentRoot可能不存在
      props: currentRoot.props,
      alternate: currentRoot
    };
    deletions = [];
    nextUnitOfWork = wipRoot;
  };

  wipFiber.hooks!.push(hook); // wipFiber.hooks = []
  hookIndex++;
  return [hook.state, setState];
}

function performUnitOfWork(fiber: Fiber) {
  const isFunctionComponent = fiber.type instanceof Function;
  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // return next unit of work
  if (fiber.child) {
    return fiber.child;
  } else {
    let nextFiber: Fiber | undefined = fiber;
    while (nextFiber) {
      if (nextFiber.sibling) {
        return nextFiber.sibling;
      } else {
        nextFiber = nextFiber.parent;
      }
    }
  }
}

function commitDeletion(fiber: Fiber, domParent: HTMLElement | Text) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child!, domParent);
  }
}
function commitWork(fiber?: Fiber) {
  if (!fiber) return;

  // for function component
  let domParentFiber = fiber.parent!; // commitWork(wipRoot.child);
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent!; // 只有 root fiber 没有 parent，但是有 dom
  }
  const domParent = domParentFiber.dom;

  if (fiber.effectTag === "PLACEMENT" && fiber.dom) {
    domParent.appendChild(fiber.dom);
  } else if (fiber.effectTag === "UPDATE" && fiber.dom) {
    updateDOMOf(fiber);
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitRoot() {
  deletions!.forEach(commitWork);
  commitWork(wipRoot!.child);
  currentRoot = wipRoot;
  wipRoot = undefined;
}

function render(fiber: Fiber, container: Fiber["dom"]) {
  if (!container) {
    throw new Error("no container");
  }

  wipRoot = {
    type: "ROOT_FIBER",
    dom: container,
    props: {
      children: [fiber]
    },
    alternate: currentRoot
  };
  deletions = [];
  nextUnitOfWork = wipRoot;
}

function workLoop(deadline: RequestIdleCallbackDeadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }

  window.requestIdleCallback(workLoop);
}
window.requestIdleCallback(workLoop);

const Didact = {
  createElement,
  render,
  useState
};

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1);
  return (
    <h1
      onClick={() => {
        setState((c) => c + 1); // TODO: number
      }}
      style="user-select: none"
    >
      Count: {state}
    </h1>
  );
}
const element = <Counter />;
const container = document.getElementById("root")!;
Didact.render(element, container);
