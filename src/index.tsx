type ReactTextElement = {
  type: "TEXT_ELEMENT";
  props: {
    nodeValue: string;
    children: never[];
  };
};

type ReactElement = {
  type: string;
  props: {
    title: string;
    children: (ReactElement | ReactTextElement)[];
  };
};

function createTextElement(text: string): ReactTextElement {
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
  props: ReactElement["props"],
  ...children: (ReactElement | string)[]
): ReactElement {
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

function render(
  element: ReactElement | ReactTextElement,
  container: HTMLElement | Text
) {
  const dom =
    element.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(element.type);

  const isProperty: (key: string) => boolean = (key) => key !== "children";
  Object.keys(element.props)
    .filter(isProperty)
    .forEach((key) => (dom[key] = element.props[key]));

  element.props.children.forEach((child) => {
    render(child, dom);
  });

  container.appendChild(dom);
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
