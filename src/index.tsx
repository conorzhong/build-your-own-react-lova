function createTextElement(text: string): Fiber {
  return {
    type: "TEXT_ELEMENT",
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
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      )
    }
  };
}

function createDom(fiber: Fiber) {
  const dom =
    fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type!); // root fiber 没有 type，但是其 dom 就是传入的 container

  const isProperty = (key: string) => key !== "children";
  Object.keys(fiber.props)
    .filter(isProperty)
    .forEach((name) => {
      dom[name] = fiber.props[name];
    });
  return dom;
}

function render(element: Fiber, container: HTMLElement | Text) {
  nextUnitOfWork = {
    dom: container,
    props: {
      children: [element]
    }
  };
}

type Fiber = {
  type?: string; // root fiber 没有 type
  dom?: HTMLElement | Text | null; // newFiber 的时候初始化为 null
  props: {
    // render 时将 [element] 作为 children 传入 root fiber；createElement中的 rest 参数也保证 children 一定存在且是数组
    children: Fiber[];
    nodeValue?: string; // for Text Node
  };
  parent?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
};
let nextUnitOfWork: Fiber | null | undefined = null;

function workLoop(deadline: any) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }
  window.requestIdleCallback(workLoop);
}

window.requestIdleCallback(workLoop);

function performUnitOfWork(fiber: Fiber): Fiber | undefined {
  // add dom node
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  if (fiber.parent) {
    fiber.parent.dom!.appendChild(fiber.dom); // 前面已经确保 fiber 上有 dom了
  }

  // create new fibers
  const elements = fiber.props.children;
  let index = 0;
  let prevSibling = null;

  while (index < elements.length) {
    const element = elements[index];
    const newFiber: Fiber = {
      type: element.type,
      props: element.props,
      parent: fiber,
      dom: null
    };

    if (index === 0) {
      fiber.child = newFiber;
    } else {
      prevSibling!.sibling = newFiber; // 第0次循环，prevSibling 会被初始化
    }

    prevSibling = newFiber;
    index++;
  }

  // return next unit of work
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber: Fiber | undefined = fiber;
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    nextFiber = nextFiber.parent;
  }
}

const Didact = {
  createElement,
  render
};

/** @jsx Didact.createElement */
const element = (
  <div id="foo">
    <a>bar</a>
    <b />
  </div>
);

const container = document.getElementById("root");
Didact.render(element, container!);

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
