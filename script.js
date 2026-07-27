const api = "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"
const inp = document.getElementById('inp')
const images = document.querySelector('.images')
const getImage = async {} => {
  // open a request to openai api
const methods = {
  method:"POST",
  headers:{
  "Content-Type":"application/json",
    "Authorization":`Bearer ${api}`
  },
  body:JSON.sringify(
    {
      "prompt":inp.value,
      "n":3,
      "size":"256×256"
    }
  )
}
  const res = await fetch("https://api.openai.com/v1/images/generations", methods)
  // parse the response as json
  const data = await res.json()
  const listImages = data.data;
  images.innerHTML = ''
  listImages.map(photo => {
    const container = document.createElement("div")
    images.append(container)
    const img = document.createElement("img")
    container.append(img)
    img.src = photo.url
  })
}